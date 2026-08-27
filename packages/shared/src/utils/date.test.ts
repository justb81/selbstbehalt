// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, toIsoDate } from './date.js';

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

describe('toIsoDate', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 2, 16))).toBe('2026-03-16');
  });

  it('pads single-digit month and day', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('reads the local calendar day, not the UTC instant', () => {
    // 23:30 local on the 16th stays the 16th even where UTC is already the 17th.
    expect(toIsoDate(new Date(2026, 2, 16, 23, 30))).toBe('2026-03-16');
  });
});

describe('formatDateTime', () => {
  it('renders an ISO timestamp as a de-DE date and time', () => {
    // Fixed offset so the assertion does not depend on the runner's zone.
    const formatted = formatDateTime('2026-03-16T09:30:00.000Z');
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.2026, \d{2}:\d{2}$/);
  });

  it('renders nothing known as an em dash', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });

  it('passes an unparseable value through unchanged', () => {
    expect(formatDateTime('irgendwann')).toBe('irgendwann');
  });
});
