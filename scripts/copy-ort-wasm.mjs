// SPDX-License-Identifier: Apache-2.0
//
// Copies the ONNX Runtime Web WASM assets into every app's static/models/ort/
// (apps/frontend and apps/goae-waechter — issue #170) so they are served
// same-origin (no CDN at runtime — CLAUDE.md privacy constraint; docs/design.md
// §1.3/§8). The OCR engine points `ort.env.wasm.wasmPaths` at `/models/ort/`
// (see packages/medic-invoice-check/src/lib/ocr/engine.ts), and each app's
// service worker already caches `/models/**` on first use (§6.3).
//
// Runs automatically as part of each app's `build` script; the copied files are
// git-ignored.
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
// Every app that serves the ONNX Runtime WASM from its own static/models/ort/.
// Keep in sync with fetch-ocr-models.mjs's DEST_APPS.
const DEST_APPS = ['apps/frontend', 'apps/goae-waechter'];

// onnxruntime-web is a dependency of @selbstbehalt/medic-invoice-check (which
// owns the OCR pipeline); resolve its dist dir from there. The apps only serve
// the copied WASM under /models/ort/ same-origin — they no longer depend on
// onnxruntime-web directly.
const requireFromPackage = createRequire(join(ROOT, 'packages/medic-invoice-check/package.json'));
const distDir = dirname(requireFromPackage.resolve('onnxruntime-web'));

const FILES = [
  'ort-wasm-simd-threaded.wasm', // plain WASM execution provider (fallback)
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm', // JSEP build (WebGPU execution provider)
  'ort-wasm-simd-threaded.jsep.mjs',
];

for (const app of DEST_APPS) {
  const dest = join(ROOT, app, 'static/models/ort');
  mkdirSync(dest, { recursive: true });
  for (const file of FILES) {
    copyFileSync(join(distDir, file), join(dest, file));
    console.log(`${app}/static/models/ort/${file} ← onnxruntime-web`);
  }
}
console.log('ONNX Runtime WASM assets copied');
