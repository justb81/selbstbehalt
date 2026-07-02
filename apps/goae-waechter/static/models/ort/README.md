# On-device ONNX Runtime Web WASM assets

Same setup as `apps/frontend` (see `apps/frontend/static/models/ort/README.md`) —
GOÄ-Wächter is a separate static deployment (issue #170), so it serves its own
copy of the same WASM assets from its own origin, pinned by
`packages/medic-invoice-check/src/lib/ocr/engine.ts` at `/models/ort/`.

## Expected files

Copied here from the installed `onnxruntime-web` package:

- `ort-wasm-simd-threaded.jsep.wasm` / `.jsep.mjs` — JSEP build (WebGPU EP)
- `ort-wasm-simd-threaded.wasm` / `.mjs` — plain build (WASM fallback EP)

## Populating

These are git-ignored (see `.gitignore`) and copied automatically by the build:

```bash
pnpm --filter @selbstbehalt/goae-waechter build   # runs scripts/copy-ort-wasm.mjs first
# or directly:
pnpm ocr:wasm
```

Re-run after upgrading `onnxruntime-web` so the served WASM matches the bundled
JS runtime.
