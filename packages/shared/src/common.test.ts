// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { isoDate, isoDateTime, money, uuid } from './common.js';

describe('money', () => {
  it('accepts non-negative amounts with up to two decimals', () => {
    expect(money.parse(0)).toBe(0);
    expect(money.parse(85)).toBe(85);
    expect(money.parse(62.5)).toBe(62.5);
    expect(money.parse(181.4)).toBe(181.4);
    expect(money.parse(0.01)).toBe(0.01);
  });

  it('rejects negative amounts', () => {
    expect(money.safeParse(-1).success).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(money.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(money.safeParse(Number.NaN).success).toBe(false);
  });

  it('rejects more than two decimal places', () => {
    expect(money.safeParse(1.234).success).toBe(false);
    expect(money.safeParse(0.001).success).toBe(false);
  });

  it('rejects non-number input', () => {
    expect(money.safeParse('85').success).toBe(false);
  });
});

describe('isoDate', () => {
  it('accepts a valid calendar day', () => {
    expect(isoDate.parse('2024-01-01')).toBe('2024-01-01');
    expect(isoDate.parse('2026-06-27')).toBe('2026-06-27');
  });

  it('rejects malformed strings', () => {
    expect(isoDate.safeParse('27.06.2026').success).toBe(false);
    expect(isoDate.safeParse('2026-6-7').success).toBe(false);
    expect(isoDate.safeParse('2026/06/27').success).toBe(false);
  });

  it('rejects impossible calendar days', () => {
    expect(isoDate.safeParse('2024-02-30').success).toBe(false);
    expect(isoDate.safeParse('2024-13-01').success).toBe(false);
    expect(isoDate.safeParse('2023-02-29').success).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(isoDate.safeParse('2024-02-29').success).toBe(true);
  });
});

describe('isoDateTime', () => {
  it('accepts ISO-8601 datetimes with offset', () => {
    expect(isoDateTime.safeParse('2026-06-27T14:43:04Z').success).toBe(true);
    expect(isoDateTime.safeParse('2026-06-27T16:43:04+02:00').success).toBe(true);
  });

  it('rejects date-only strings', () => {
    expect(isoDateTime.safeParse('2026-06-27').success).toBe(false);
  });
});

describe('uuid', () => {
  it('accepts a valid UUID', () => {
    expect(uuid.safeParse('3f9a8c2e-1d4b-4c6a-9e2f-7b1c0d5e6a7f').success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(uuid.safeParse('not-a-uuid').success).toBe(false);
  });
});
