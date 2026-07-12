// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { distributeRefundByCategory, type DistributablePosition } from './refund-distribution';

function pos(
  id: string,
  category: DistributablePosition['category'],
  eligible_amount: number | null,
  charged_amount: number,
): DistributablePosition {
  return { id, category, eligible_amount, charged_amount };
}

/** Sum of the map's values, rounded, for exact-total assertions. */
function sum(m: Map<string, number>): number {
  return Math.round([...m.values()].reduce((a, b) => a + b, 0) * 100) / 100;
}

describe('distributeRefundByCategory', () => {
  it('distributes proportionally to eligible amounts within a category', () => {
    const positions = [pos('a', 'zahnbehandlung', 300, 400), pos('b', 'zahnbehandlung', 100, 200)];
    const out = distributeRefundByCategory(positions, new Map([['zahnbehandlung', 320]]));
    expect(out.get('a')).toBe(240);
    expect(out.get('b')).toBe(80);
    expect(sum(out)).toBe(320);
  });

  it('keeps the per-category sum exact despite cent rounding', () => {
    const positions = [
      pos('a', 'ambulant', 1, 1),
      pos('b', 'ambulant', 1, 1),
      pos('c', 'ambulant', 1, 1),
    ];
    // 100 / 3 = 33.333…; parts round to 33.33 each (99.99) → residual 0.01 to largest.
    const out = distributeRefundByCategory(positions, new Map([['ambulant', 100]]));
    expect(sum(out)).toBe(100);
  });

  it('falls back to charged amounts when no eligible amount is available', () => {
    const positions = [pos('a', 'ambulant', null, 300), pos('b', 'ambulant', null, 100)];
    const out = distributeRefundByCategory(positions, new Map([['ambulant', 200]]));
    expect(out.get('a')).toBe(150);
    expect(out.get('b')).toBe(50);
  });

  it('splits evenly when all weights are zero', () => {
    const positions = [pos('a', 'ambulant', 0, 0), pos('b', 'ambulant', 0, 0)];
    const out = distributeRefundByCategory(positions, new Map([['ambulant', 50]]));
    expect(out.get('a')).toBe(25);
    expect(out.get('b')).toBe(25);
    expect(sum(out)).toBe(50);
  });

  it('assigns 0 to every position of a rejected category', () => {
    const positions = [pos('a', 'zahnersatz', 500, 600), pos('b', 'zahnersatz', 200, 300)];
    const out = distributeRefundByCategory(positions, new Map([['zahnersatz', 0]]));
    expect(out.get('a')).toBe(0);
    expect(out.get('b')).toBe(0);
  });

  it('handles independent categories side by side and omits categories without an entry', () => {
    const positions = [
      pos('a', 'ambulant', 100, 100),
      pos('b', 'zahnbehandlung', 100, 100),
      pos('c', 'kieferorthopaedie', 100, 100),
    ];
    // Only two categories are entered; kieferorthopaedie has no entry → omitted.
    const out = distributeRefundByCategory(
      positions,
      new Map([
        ['ambulant', 80],
        ['zahnbehandlung', 50],
      ]),
    );
    expect(out.get('a')).toBe(80);
    expect(out.get('b')).toBe(50);
    expect(out.has('c')).toBe(false);
  });
});
