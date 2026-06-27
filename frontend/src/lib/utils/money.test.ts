// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatEur } from './money';

// ICU may separate the amount from the currency symbol with either a regular
// (U+00A0) or narrow (U+202F) no-break space; normalize so the test is robust.
const normalize = (value: string): string => value.replace(/\s/g, ' ');

describe('formatEur', () => {
  it('formats whole amounts with a thousands separator', () => {
    expect(normalize(formatEur(1234))).toBe('1.234,00 €');
  });

  it('formats fractional amounts with two decimals', () => {
    expect(normalize(formatEur(9.5))).toBe('9,50 €');
  });

  it('formats zero', () => {
    expect(normalize(formatEur(0))).toBe('0,00 €');
  });

  it('formats negative amounts', () => {
    expect(normalize(formatEur(-42.1))).toBe('-42,10 €');
  });
});
