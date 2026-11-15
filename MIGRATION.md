# Migration: Direct Query API → Inference API

This project is the [ALERTCalifornia wildfire demo](https://github.com/archetypeai/archetypeai-wildfire-demo) with its Newton calls moved from the Direct Query API (`POST /api/lens/query`) to the Inference API: Newton C 2.6 → **Newton C 2.6** (same model, new endpoint). The UI, the fire zones, the camera selection and the batch-then-overview flow are unchanged. The risk prompt gained a paragraph on look-alikes (see [Results](#results)).

All measurements below were taken on production on 2026-11-14.

## Summary

- **Endpoint:** every call is `POST /api/inference/chat/completions` on `newton-c-2.6`. The Inference API's Direct Query endpoint (`/api/inference/query`) accepts no image events, and it refuses `multi_image`; Chat Completions takes images as `image_url` parts, several per message.
- **Smaller images reach the model.** The platform gives the model a reduced copy of each frame. Asked to describe a 1920×1080 frame, the model called it "low-resolution, vertically oriented" and missed a mountain range that it described through Direct Query. Neither `detail: "high"`, the Responses API, Newton Fusion 1.0, nor splitting a frame into halves changed this.
- **Prompt tuned to compensate.** With the original prompt, the smaller frames made the model rate fog, low cloud and night lights as watch or danger. A paragraph in the risk prompt (`RISK_GUIDANCE` in `src/lib/server/newton.js`) brings the per-camera verdicts back close to the Direct Query version's.
- **Request size:** Chat Completions refuses bodies over about 2 MiB (`413`), which four full-size night frames can pass, so a scan batch closes early when its images would exceed 1.8 MiB.
- **Open-source fonts:** Geist and Geist Mono replace the design system's PP Neue Montreal, whose files can't be redistributed.

## Direct Query API vs Inference API

|              | Direct Query API                                          | Inference API                                                                    |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Endpoint     | `POST /api/lens/query`                                    | `POST /api/inference/chat/completions`                                           |
| Model        | `Newton::c2_6_8b_fp8_260424d7a55d5e`                      | `newton-c-2.6`                                                                   |
| Images       | `data.base64_img` events; `multi_image: true` for several | `image_url` parts with `data:image/jpeg;base64,…` URLs, several per user message |
| System turn  | `instruction_prompt`                                      | A `system` message                                                               |
| Token budget | `max_new_tokens`                                          | `max_completion_tokens`                                                          |
| Answer       | `response.response[0]`                                    | `choices[0].message.content`                                                     |
| Request size | 4 full-size frames per request                            | About 2 MiB per request: 3–4 frames                                              |

## What changed in the code

| File                                                                          | Change                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/newton.js`                                                    | One `chat()` helper for every call; frames as data-URI image parts; scan batches limited by count and size; `RISK_GUIDANCE` for the risk prompts. |
| `src/routes/api/analyze/+server.js`, `src/routes/api/analyze-zone/+server.js` | Append `RISK_GUIDANCE` to the system prompt.                                                                                                      |
| `vite.config.js`                                                              | The project's `.env` wins over `ATAI_*` shell variables.                                                                                          |
| `src/routes/layout.css`                                                       | Geist and Geist Mono from `@fontsource-variable` instead of the design system's `fonts.css`; the font files in `static/fonts/` are gone.          |
| Removed                                                                       | The Lens and Direct Query skills in `.claude/skills/`, which pointed coding agents at the old APIs.                                               |
| `LICENSE`                                                                     | Apache License 2.0, for the code.                                                                                                                 |

## Results

The same 60 frames (12 cameras in each of the 5 zones, fetched once at dusk) were scored by the zone scan's batch prompt on both APIs. Direct Query ran twice, to show how much it varies on its own. The Inference API gives the same answers on a repeat.

| Run                                 | Agrees with Direct Query (per camera) | Watch or danger |  Danger |
| ----------------------------------- | ------------------------------------: | --------------: | ------: |
| Direct Query, run 2 against run 1   |                                 57/60 |         5 and 8 | 3 and 4 |
| Inference API, original prompt      |                              43–45/60 |              14 |       6 |
| Inference API, with `RISK_GUIDANCE` |                              50–51/60 |               6 |       1 |

Looking at the frames behind the danger calls: both APIs rate an irregular bright patch on the vegetation at Chinese Wall (Thompson zone) as danger. Direct Query's other danger calls were street and building lights at night (Cloudcroft Debris Basin, Yankee Hill), which the tuned Inference API version rates clear. The tuned version's remaining watch calls are mostly fog and low cloud.

Night scenes remain the weak spot: in a live scan the tuned version still rated a streetlit concrete wall (Sierra Madre Canyon) as danger, which Direct Query rated clear.

### Speed

|                                      | Direct Query | Inference API |
| ------------------------------------ | -----------: | ------------: |
| Image batches for one zone (3 calls) |      15–37 s |       11–14 s |
| Whole zone scan, with the overview   |            — |         ~16 s |
