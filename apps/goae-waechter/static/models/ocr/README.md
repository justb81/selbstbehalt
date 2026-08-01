# On-device PP-OCRv6 models

Same on-device OCR pipeline as `apps/frontend` (see
`apps/frontend/static/models/ocr/README.md` for the full explanation) — GOÄ-Wächter
is a separate static deployment (issue #170), so it serves its own copy of the
same three files from its own origin.

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
