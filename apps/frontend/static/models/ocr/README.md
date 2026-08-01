# On-device PP-OCRv6 models

The client-side OCR pipeline (`docs/design.md` §4, issue #27) runs **PP-OCRv6**
through the [`ppu-paddle-ocr`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr)
binding on ONNX Runtime (WebGPU, with an automatic WASM fallback). The binding's
built-in defaults would fetch the model files from a third-party GitHub host at
runtime — which the project's privacy rules forbid (no external CDN; invoice
images and the model both stay on-device, `docs/design.md` §1.3/§8).

To honour that, the engine is **always** pointed at the three files below, served
same-origin from `/models/ocr/`. The service worker caches `/models/**` on first
use (the “Cache After First Load” strategy, `docs/design.md` §6.3), so after the
initial visit OCR works fully offline.

**Why `.onnx`, not `.ort`.** The upstream repo also publishes PP-OCRv6 in the
ORT binary format (`.ort`), which is smaller for mobile builds — but that format
fails to build an ONNX Runtime Web session on the WebGPU/JSEP execution
provider (`ResolveKernelTypeStr Failed to find op_id: com.ms.internal.nhwc:Conv:1`,
verified against `onnxruntime-web` 1.27 in a real browser, issue #317): the ORT
conversion bakes in a fixed kernel layout and doesn't carry the runtime NHWC
transform JSEP needs. The plain `.onnx` files (same weights) load fine on both
WebGPU and WASM, so that's what we fetch.

## Expected files

| File served at         | Model (PP-OCRv6 tiny)                     | ~size   |
| ---------------------- | ----------------------------------------- | ------- |
| `/models/ocr/det.onnx` | tiny text **detection**                   | ~1.8 MB |
| `/models/ocr/rec.onnx` | tiny text **recognition** (covers German) | ~4.4 MB |
| `/models/ocr/dict.txt` | tiny character **dictionary**             | ~27 KB  |

These paths are the defaults in `packages/medic-invoice-check/src/lib/ocr/types.ts`
(`DEFAULT_MODEL_URLS`); change them there and here together if you host a
different model.

## Fetching them

The files are large binaries and are **not** committed to git (see `.gitignore`)
— they are maintainer-curated build inputs, the same policy as the GOÄ/GOZ/GOT
source data. Download them with:

```bash
pnpm ocr:models
```

This runs `scripts/fetch-ocr-models.mjs`, which pulls the PP-OCRv6 tiny
detection model, the tiny recognition model, and the tiny dictionary from the
[`ppu-paddle-ocr-models`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models)
release repository into this directory — and, in the same run, into
`apps/goae-waechter/static/models/ocr/` (issue #170), which serves an identical
copy from its own origin. Re-run it to refresh the models in both apps.

## Integrity verification

Each download is verified against the SHA-256 pinned in **`models.sha256`** (the
canonical hash list, committed alongside this README — `apps/goae-waechter`'s
copy of the same three files is verified against this list too, not a separate
one). A mismatch — supply-chain substitution, Git-LFS corruption, or a truncated
download — deletes the bad file and fails the script. When you intentionally
refresh the models, regenerate the hashes (e.g.
`sha256sum det.onnx rec.onnx dict.txt > models.sha256` from this directory) in
the same change.
