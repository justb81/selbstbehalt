// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { partialFailureMessage, settledValues } from './partial-load';

describe('settledValues', () => {
  it('keeps the successes and marks the failures as null, in input order', async () => {
    const results = await Promise.allSettled([
      Promise.resolve('a'),
      Promise.reject(new Error('weg')),
      Promise.resolve('c'),
    ]);

    expect(settledValues(results)).toEqual(['a', null, 'c']);
  });

  it('preserves a fulfilled null without conflating it with a failure', async () => {
    const results = await Promise.allSettled([Promise.resolve(null)]);
    expect(settledValues(results)).toEqual([null]);
  });

  it('returns an empty list for no tasks', () => {
    expect(settledValues([])).toEqual([]);
  });
});

describe('partialFailureMessage', () => {
  it('names how many of how many are missing', () => {
    expect(partialFailureMessage(1, 3, 'Jahreswerte')).toBe(
      'Jahreswerte: 1 von 3 konnten nicht geladen werden.',
    );
  });

  it('stays silent when nothing failed', () => {
    expect(partialFailureMessage(0, 3, 'Jahreswerte')).toBeNull();
    expect(partialFailureMessage(0, 0, 'Jahreswerte')).toBeNull();
  });

  it('stays silent when there was nothing to load', () => {
    expect(partialFailureMessage(2, 0, 'Jahreswerte')).toBeNull();
  });
});
