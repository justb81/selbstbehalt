# On-device PP-OCRv5 models

Same on-device OCR pipeline as `apps/frontend` (see
`apps/frontend/static/models/ocr/README.md` for the full explanation) — GOÄ-Wächter
is a separate static deployment (issue #170), so it serves its own copy of the
same three files from its own origin.

## Expected files

| File served at         | Model (PP-OCRv5)                                  | ~size   |
| ---------------------- | ------------------------------------------------- | ------- |
| `/models/ocr/det.onnx` | mobile text **detection**                         | ~4.5 MB |
| `/models/ocr/rec.onnx` | Latin mobile text **recognition** (covers German) | ~7.7 MB |
| `/models/ocr/dict.txt` | Latin character **dictionary**                    | ~3 KB   |

These paths are the defaults in `packages/medic-invoice-check/src/lib/ocr/types.ts`
(`DEFAULT_MODEL_URLS`); change them there and here together if you host a
different model.

## Fetching them

The files are large binaries and are **not** committed to git (see `.gitignore`).
Download them with:

```bash
pnpm ocr:models
```

This runs `scripts/fetch-ocr-models.mjs`, which populates this directory (and
`apps/frontend/static/models/ocr/`) from the
[`ppu-paddle-ocr-models`](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models)
release repository, verified against `models.sha256`. Re-run it to refresh the
models in both apps at once.

## Integrity verification

Each download is verified against the SHA-256 pinned in **`models.sha256`**,
identical to `apps/frontend/static/models/ocr/models.sha256` (same upstream
models, same hashes).
