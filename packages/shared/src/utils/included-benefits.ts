// SPDX-License-Identifier: Apache-2.0
//
// Parse/serialize helpers for the `insured_persons.included_benefits` TEXT
// column. The backend reads it via Drizzle's `mode: 'json'` (already typed as
// `IncludedBenefits`); these helpers cover the cases where the value is handled
// as a raw JSON string — e.g. backup import/export or any direct TEXT access —
// and guarantee that what comes out is schema-valid and typed.

import { includedBenefitsSchema, type IncludedBenefits } from '../schemas/included-benefits.js';

/**
 * Parse the raw TEXT value of `included_benefits` into a validated
 * {@link IncludedBenefits}. Returns `null` for an absent/empty column
 * (`null`/`undefined`/`''`). Throws a `SyntaxError` for malformed JSON and a
 * `ZodError` for JSON that does not match the schema.
 */
export function parseIncludedBenefits(text: string | null | undefined): IncludedBenefits | null {
  if (text == null || text.trim() === '') return null;
  return includedBenefitsSchema.parse(JSON.parse(text));
}

/**
 * Serialize {@link IncludedBenefits} to the JSON string stored in the TEXT
 * column. Validates first, so an invalid structure never reaches the DB.
 */
export function serializeIncludedBenefits(benefits: IncludedBenefits): string {
  return JSON.stringify(includedBenefitsSchema.parse(benefits));
}
