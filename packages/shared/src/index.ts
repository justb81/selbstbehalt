// SPDX-License-Identifier: Apache-2.0
//
// @selbstbehalt/shared — the single source of truth for the data shapes that the
// backend (API validation) and frontend (forms, API client) both depend on.
// Re-exports every enum, primitive, and entity schema plus their inferred types,
// and the shared domain helpers (BRE ladder math).

export * from './enums.js';
export * from './common.js';
export * from './api.js';
export * from './schemas/person.js';
export * from './schemas/contract.js';
export * from './schemas/included-benefits.js';
export * from './schemas/insured-person.js';
export * from './schemas/invoice.js';
export * from './schemas/invoice-position.js';
export * from './schemas/submission.js';
export * from './schemas/bre-period.js';
export * from './utils/bre.js';
export * from './utils/included-benefits.js';
export * from './utils/money.js';
