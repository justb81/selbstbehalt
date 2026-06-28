// SPDX-License-Identifier: Apache-2.0
//
// Copies the ONNX Runtime Web WASM assets into frontend/static/models/ort/ so
// they are served same-origin (no CDN at runtime — CLAUDE.md privacy
// constraint; docs/design.md §1.3/§8). The OCR engine points
// `ort.env.wasm.wasmPaths` at `/models/ort/` (see frontend/src/lib/ocr/engine.ts),
// and the service worker already caches `/models/**` on first use (§6.3).
//
// Runs automatically as part of `pnpm --filter @selbstbehalt/frontend build`
// (and therefore in the Docker build); the copied files are git-ignored.
//
// We copy the JSEP build (WebGPU execution provider) and the plain build (WASM
// fallback) — both the `.wasm` binary and its emscripten `.mjs` loader, which
// ONNX Runtime fetches from `wasmPaths` at init.
//
// Run: node scripts/copy-ort-wasm.mjs

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'frontend/static/models/ort');

// onnxruntime-web is a dependency of the frontend package; resolve its dist dir
// from there rather than the repo root (pnpm keeps it in frontend/node_modules).
const requireFromFrontend = createRequire(join(ROOT, 'frontend/package.json'));
const distDir = dirname(requireFromFrontend.resolve('onnxruntime-web'));

const FILES = [
  'ort-wasm-simd-threaded.wasm', // plain WASM execution provider (fallback)
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm', // JSEP build (WebGPU execution provider)
  'ort-wasm-simd-threaded.jsep.mjs',
];

mkdirSync(DEST, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(distDir, file), join(DEST, file));
  console.log(`frontend/static/models/ort/${file} ← onnxruntime-web`);
}
console.log('ONNX Runtime WASM assets copied');
