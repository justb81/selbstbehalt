// SPDX-License-Identifier: Apache-2.0
//
// GOÄ-Wächter is a fully client-rendered SPA: it has no backend at all (issue
// #170) and invoice OCR runs entirely in the browser. adapter-static emits the
// SPA shell as a fallback.
export const ssr = false;
export const prerender = false;
