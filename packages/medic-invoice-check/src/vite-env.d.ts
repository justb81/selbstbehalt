// SPDX-License-Identifier: Apache-2.0
// Ambient types for the Vite build environment this package is compiled in:
// `import.meta.env` and the `?worker`/`?url` import suffixes used by the OCR
// pipeline (pdf.ts imports the pdf.js worker via `?worker`). apps/frontend gets
// these from SvelteKit's generated ambient types; as a standalone package we
// reference Vite's client types directly.
/// <reference types="vite/client" />
