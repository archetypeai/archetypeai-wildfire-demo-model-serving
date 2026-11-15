import { ATAI_API_KEY, ATAI_API_ENDPOINT } from '$env/static/private';

const MODEL = 'newton-c-2.6';

function apiUrl(path) {
	const root = ATAI_API_ENDPOINT.replace(/\/$/, '').replace(/\/api$/, '');
	return `${root}/api${path}`;
}

// The Inference API hands the model a downscaled copy of each frame, and at that
// size C 2.6 reads fog, low cloud and night lights as smoke or fire. This
// guidance brings its verdicts back in line with the full-resolution Direct
// Query version (see MIGRATION.md).
export const RISK_GUIDANCE =
	' Judge carefully between weather and smoke. Low cloud, fog, marine layer, overcast skies, rain, dust on the lens, water droplets, sun glare, and sunrise or sunset colours are NOT smoke: rate them clear.' +
	' Rate watch only for a distinct column or plume of smoke rising from the ground, or brown or grey haze that is clearly not cloud.' +
	' Rate danger only for visible flames, fire glow, or a large active smoke plume. When unsure, rate clear.' +
	' At night the cameras switch to black-and-white infrared: city lights, street lights, building and vehicle lights, their glow on fog or cloud, and a band of skyglow along the horizon from a city beyond the ridge are NOT fire.' +
	' Fire at night is an irregular bright patch on the vegetation itself, not a point light or a light from a town.';

const ZONE_STATUS_MAP = { clear: 'good', watch: 'warning', danger: 'critical' };

// Bound the per-call vision load: encoding too many full-res frames in one
// multi-image batch can OOM the model GPU (12×1080p crashed it). Keep batches
// small and run them sequentially so peak vision-token load stays low.
const ZONE_CHUNK_SIZE = 4;
// Chat Completions refuses request bodies over about 2 MiB (413), and four
// full-resolution night frames can exceed that, so a batch also closes early
// once its images would pass this many base64 characters.
const ZONE_CHUNK_CHARS = 1.8 * 1024 * 1024;

// Group cameras into batches of at most ZONE_CHUNK_SIZE frames and
// ZONE_CHUNK_CHARS of image data, in camera order.
function batchBySize(items) {
	const batches = [];
	let current = [];
	let chars = 0;
	for (const item of items) {
		const size = item.image.image_url.url.length;
		if (current.length && (current.length === ZONE_CHUNK_SIZE || chars + size > ZONE_CHUNK_CHARS)) {
			batches.push(current);
			current = [];
			chars = 0;
		}
		current.push(item);
		chars += size;
	}
	if (current.length) batches.push(current);
	return batches;
}

// Tolerant JSON-array parse: strip markdown fences and slice to the outer [].
function parseJsonArray(text) {
	let t = (text || '').trim();
	t = t
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();
	const start = t.indexOf('[');
	const end = t.lastIndexOf(']');
	if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
	return JSON.parse(t);
}

// Camera frames go up inline as data-URI image parts. (The Inference API's
// /query endpoint takes no image events, so every call uses Chat Completions.)
async function fetchImagePart(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch camera image: ${res.status}`);
	const mimeType = res.headers.get('content-type') || 'image/jpeg';
	return imagePart(Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType);
}

function imagePart(base64, mimeType = 'image/jpeg') {
	return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } };
}

// One stateless POST /api/inference/chat/completions: the system turn, then a
// user turn of image parts followed by the question. Returns the answer text.
async function chat({ system, images = [], text, maxTokens }, timeoutMs) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(apiUrl('/inference/chat/completions'), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ATAI_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: MODEL,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: [...images, { type: 'text', text }] }
				],
				max_completion_tokens: maxTokens
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(
				`POST /api/inference/chat/completions failed: ${res.status} - ${JSON.stringify(err)}`
			);
		}
		const content = (await res.json())?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') throw new Error('Unexpected response: no message content');
		return content;
	} finally {
		clearTimeout(timeoutId);
	}
}

// Analyze an entire zone without overloading the model GPU. Per-camera vision
// runs in small SEQUENTIAL multi-image batches (≤ ZONE_CHUNK_SIZE frames each,
// so peak vision-token load stays well under the level that OOM'd the engine),
// then a single text-only call synthesizes one zone overview from the findings.
// Returns { overview, cameras: [{ camera_index, status: good|warning|critical }] }.
export async function analyzeZone(cameras, instruction, timeoutMs = 120000) {
	const perCamera = []; // aligned to camera order: { name, status, summary }

	const frames = await Promise.all(
		cameras.map(async (cam) => ({
			cam,
			image: await fetchImagePart(
				`https://cameras.alertcalifornia.org/public-camera-data/${cam.id}/latest-frame.jpg?rqts=${Math.floor(Date.now() / 1000)}`
			)
		}))
	);
	for (const batch of batchBySize(frames)) {
		const chunk = batch.map((f) => f.cam);
		const images = batch.map((f) => f.image);
		const labels = chunk
			.map((c, j) => `Image ${j} = "${c.name}"${c.county ? ` (${c.county} County)` : ''}`)
			.join('. ');
		const text = await chat(
			{
				text:
					`You are given ${chunk.length} wildfire camera frames as independent images, in order. ${labels}. ` +
					'For EACH image, assess wildfire risk from visible smoke, fire glow, haze, or unusual atmospheric conditions. ' +
					`Respond with ONLY a JSON array (no markdown fences) of ${chunk.length} objects in image order: ` +
					'[{"camera_index": <int>, "status": "clear|watch|danger", "summary": "<one sentence>"}].',
				system: `${instruction} Output only the JSON array, no prose, no markdown fences.`,
				images,
				maxTokens: 600
			},
			timeoutMs
		);
		const parsed = parseJsonArray(text);
		chunk.forEach((cam, j) => {
			const entry = parsed.find((p) => p.camera_index === j) ?? parsed[j] ?? {};
			perCamera.push({
				name: cam.name,
				status: ZONE_STATUS_MAP[String(entry.status).toLowerCase()] ?? 'good',
				summary: entry.summary ?? ''
			});
		});
	}

	// Synthesize one zone overview from the per-camera findings — text only, so
	// there is no image-vision GPU pressure.
	const digest = perCamera
		.map((c, i) => `${i + 1}. ${c.name}: ${c.status.toUpperCase()} — ${c.summary}`)
		.join('\n');
	const overview = await chat(
		{
			text:
				`Per-camera wildfire assessments across the zone:\n${digest}\n\n` +
				'Write a 2-4 sentence overview of the WHOLE zone: overall risk level, roughly how many cameras are clear vs of concern, and name any camera showing smoke, fire, or haze. Plain prose, no JSON.',
			system: instruction,
			maxTokens: 300
		},
		timeoutMs
	);

	return {
		overview: overview.trim() || 'No overview returned.',
		cameras: perCamera.map((c, i) => ({ camera_index: i, status: c.status, summary: c.summary }))
	};
}

// Text-only Q&A about a zone, grounded in the latest scan findings. No images
// are sent (so no GPU-vision pressure) — the model answers from the digest.
export async function chatAboutZone(question, findings, overview, instruction, timeoutMs = 60000) {
	const digest = (findings || [])
		.map(
			(f, i) =>
				`${i + 1}. ${f.name}: ${String(f.status || '').toUpperCase()} — ${f.summary || 'no summary'}`
		)
		.join('\n');
	const context = `Latest zone scan.\nOverview: ${overview || 'n/a'}\n\nPer-camera findings:\n${digest}`;
	return chat(
		{
			text: `${context}\n\nUser question: ${question}\n\nAnswer concisely, based only on the scan results above. You can answer both zone-wide questions and questions about a specific camera (referenced by its name). If the answer isn't in the results, say so.`,
			system: `${instruction} You answer questions about a zone of wildfire cameras using the provided scan results — both zone-wide and about individual cameras by name.`,
			maxTokens: 400
		},
		timeoutMs
	);
}

// Detailed analysis of one camera frame.
export function analyzeImage(
	rawBase64,
	instruction,
	query,
	mimeType = 'image/jpeg',
	timeoutMs = 60000
) {
	return chat(
		{ system: instruction, images: [imagePart(rawBase64, mimeType)], text: query, maxTokens: 512 },
		timeoutMs
	);
}
