// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatEur, roundCents } from './money.js';

describe('roundCents', () => {
  it('rounds to whole cents', () => {
    expect(roundCents(10.715)).toBe(10.72);
    expect(roundCents(5.364)).toBe(5.36);
    expect(roundCents(0)).toBe(0);
  });

  it('clears binary-float noise', () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe('formatEur', () => {
  it('formats as a de-DE EUR string', () => {
    // Non-breaking space before the € sign; assert on the parts instead.
    const s = formatEur(1234.5);
    expect(s).toContain('1.234,50');
    expect(s).toContain('€');
  });
});
