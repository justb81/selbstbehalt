# On-device ONNX Runtime Web WASM assets

The OCR engine runs PP-OCRv5 on **ONNX Runtime Web** (`ppu-paddle-ocr`). ONNX
Runtime loads its WASM binaries at init from `ort.env.wasm.wasmPaths`, which the
engine pins to **`/models/ort/`** (`packages/medic-invoice-check/src/lib/ocr/engine.ts`) so they are
served same-origin and never fetched from a CDN at runtime (CLAUDE.md privacy
constraint; `docs/design.md` §1.3/§8). The service worker caches `/models/**` on
first use (§6.3), so OCR works offline after the first run.

## Expected files

Copied here from the installed `onnxruntime-web` package:

- `ort-wasm-simd-threaded.jsep.wasm` / `.jsep.mjs` — JSEP build (WebGPU EP)
- `ort-wasm-simd-threaded.wasm` / `.mjs` — plain build (WASM fallback EP)

## Populating

These are git-ignored (see `.gitignore`) and copied automatically by the
frontend build:

```bash
pnpm --filter @selbstbehalt/frontend build   # runs scripts/copy-ort-wasm.mjs first
# or directly:
pnpm ocr:wasm
```

The same script also populates `apps/goae-waechter/static/models/ort/` (issue
#170) with an identical copy for that app's own build. Re-run after upgrading
`onnxruntime-web` so the served WASM matches the bundled JS runtime in both
apps.
