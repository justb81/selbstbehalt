// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { distributeCentsProportionally } from './proportional-cents';

const sum = (parts: number[]) => Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;

describe('distributeCentsProportionally', () => {
  it('returns an empty array for no weights', () => {
    expect(distributeCentsProportionally(100, [])).toEqual([]);
  });

  it('keeps the sum exact when the split does not divide evenly', () => {
    const parts = distributeCentsProportionally(100, [100, 100, 100]);
    expect(sum(parts)).toBe(100);
    // Equal weights: the residual lands on the first of them.
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it('pushes the residual onto the largest weight', () => {
    const parts = distributeCentsProportionally(100, [10, 10, 80]);
    expect(sum(parts)).toBe(100);
    expect(parts[2]).toBeGreaterThan(parts[0]!);
  });

  it('splits evenly when all weights are zero or invalid', () => {
    expect(distributeCentsProportionally(90, [0, 0, 0])).toEqual([30, 30, 30]);
    expect(distributeCentsProportionally(90, [-5, Number.NaN, 0])).toEqual([30, 30, 30]);
  });

  it('ignores non-positive weights next to positive ones', () => {
    expect(distributeCentsProportionally(50, [0, 100])).toEqual([0, 50]);
  });

  it('handles a single weight', () => {
    expect(distributeCentsProportionally(33.33, [1])).toEqual([33.33]);
  });

  it('distributes zero as zero', () => {
    expect(distributeCentsProportionally(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });
});
