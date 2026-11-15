import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Let the project .env win over ATAI_API_* exported in the shell (e.g. a
// ~/.zshrc pointing at another environment), which Vite would otherwise prefer.
if (existsSync('.env')) Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')));

export default defineConfig({ plugins: [tailwindcss(), sveltekit()] });
