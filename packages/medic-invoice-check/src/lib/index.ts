// SPDX-License-Identifier: Apache-2.0
//
// @selbstbehalt/medic-invoice-check — the framework-light, backend-free
// scan-and-check engine for German medical invoices (GOÄ **and** GOZ, plus GOT).
// One source of truth shared by apps/frontend and the GOÄ-Wächter demo (see
// issue #166): the on-device OCR pipeline, the fee-schedule parser validating
// the full GOÄ/GOZ/GOT rule set (§5 Steigerungsfaktor limits, code exclusions,
// Höchstwerte, frequency limits, and more), the versioned fee tables, and the
// reusable scan + review UI. Nothing here talks to a backend or sends an image
// off-device.

// --- Domain logic -----------------------------------------------------------
export * from './ocr/index.js';
export * from './utils/goae-parser.js';
export * from './data/fee-schedule.js';
export { FEE_SCHEDULE_IDS, loadFeeTable } from './data/fee-tables.js';

// --- Components -------------------------------------------------------------
export { default as OCRScanner } from './components/OCRScanner.svelte';
export { default as InvoiceReview } from './components/InvoiceReview.svelte';
export type { ReviewPositionRow } from './components/invoice-review-types.js';
