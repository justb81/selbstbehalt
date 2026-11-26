// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatDecimal, formatPercent } from './number.js';

describe('formatDecimal', () => {
  it('uses the German decimal comma with two fraction digits by default', () => {
    expect(formatDecimal(2.3)).toBe('2,30');
    expect(formatDecimal(1.15)).toBe('1,15');
  });

  it('honours a custom fraction-digit count', () => {
    expect(formatDecimal(3.5, 1)).toBe('3,5');
    expect(formatDecimal(3.5, 0)).toBe('4');
  });

  it('groups thousands with a dot', () => {
    expect(formatDecimal(1234.5)).toBe('1.234,50');
  });

  it('renders unknown as an em dash but a genuine zero as zero', () => {
    expect(formatDecimal(null)).toBe('—');
    expect(formatDecimal(undefined)).toBe('—');
    expect(formatDecimal(0)).toBe('0,00');
  });
});

describe('formatPercent', () => {
  it('formats a rate as a de-DE percentage', () => {
    // de-DE puts a non-breaking space before the % sign.
    expect(formatPercent(0.03)).toBe('3,0 %');
    expect(formatPercent(0.025, 2)).toBe('2,50 %');
  });

  it('renders unknown as an em dash', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
  });
});
