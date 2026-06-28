# On-device PP-OCRv5 models

The client-side OCR pipeline (`docs/design.md` §4, issue #27) runs **PP-OCRv5**
through the [`ppu-paddle-ocr`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
binding on ONNX Runtime (WebGPU, with an automatic WASM fallback). The binding's
built-in defaults would fetch the model files from a third-party GitHub host at
runtime — which the project's privacy rules forbid (no external CDN; invoice
images and the model both stay on-device, `docs/design.md` §1.3/§8).

To honour that, the engine is **always** pointed at the three files below, served
same-origin from `/models/ocr/`. The service worker caches `/models/**` on first
use (the “Cache After First Load” strategy, `docs/design.md` §6.3), so after the
initial visit OCR works fully offline.

## Expected files

| File served at         | Model (PP-OCRv5)                                  | ~size  |
| ---------------------- | ------------------------------------------------- | ------ |
| `/models/ocr/det.onnx` | mobile text **detection**                         | ~5 MB  |
| `/models/ocr/rec.onnx` | Latin mobile text **recognition** (covers German) | ~20 MB |
| `/models/ocr/dict.txt` | Latin character **dictionary**                    | ~small |

These paths are the defaults in `frontend/src/lib/ocr/types.ts`
(`DEFAULT_MODEL_URLS`); change them there and here together if you host a
different model.

## Fetching them

The files are large binaries and are **not** committed to git (see `.gitignore`)
— they are maintainer-curated build inputs, the same policy as the GOÄ/GOZ/GOT
source data. Download them with:

```bash
pnpm ocr:models
```

This runs `scripts/fetch-ocr-models.mjs`, which pulls the INT8 PP-OCRv5 mobile
detection model, the Latin recognition model, and the Latin dictionary from the
[`ppu-paddle-ocr-models`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models)
release repository into this directory. Re-run it to refresh the models.
