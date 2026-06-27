// SPDX-License-Identifier: Apache-2.0
//
// Fully client-rendered SPA: no SSR or prerender of dynamic data. The backend is
// a separate REST service reached at runtime and invoice OCR runs in the browser
// (docs/design.md §1.3, §2.1). adapter-static emits the SPA shell as a fallback.
export const ssr = false;
export const prerender = false;
