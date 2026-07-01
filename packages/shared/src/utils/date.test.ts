// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatDate } from './date.js';

describe('formatDate', () => {
  it('formats an ISO date as de-DE', () => {
    expect(formatDate('2026-03-16')).toBe('16.03.2026');
  });

  it('returns — for null, undefined and empty string', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('returns a non-ISO string unchanged', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});
