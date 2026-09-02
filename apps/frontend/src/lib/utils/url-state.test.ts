// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { readNumberParam, readParam, withParam } from './url-state';

const url = (path: string) => new URL(`http://localhost${path}`);

describe('readParam', () => {
  it('returns the raw value', () => {
    expect(readParam(url('/invoices?payment=offen'), 'payment')).toBe('offen');
  });

  it('returns null for a missing or empty key', () => {
    expect(readParam(url('/invoices'), 'payment')).toBeNull();
    expect(readParam(url('/invoices?payment='), 'payment')).toBeNull();
  });

  it('returns null for a value outside the allow-list', () => {
    const allowed = ['offen', 'bezahlt'] as const;
    expect(readParam(url('/invoices?payment=bezahlt'), 'payment', allowed)).toBe('bezahlt');
    expect(readParam(url('/invoices?payment=irgendwas'), 'payment', allowed)).toBeNull();
  });
});

describe('readNumberParam', () => {
  it('parses an integer', () => {
    expect(readNumberParam(url('/stats?year=2024'), 'year')).toBe(2024);
  });

  it('returns null for non-integer or missing values', () => {
    expect(readNumberParam(url('/stats?year=2024.5'), 'year')).toBeNull();
    expect(readNumberParam(url('/stats?year=abc'), 'year')).toBeNull();
    expect(readNumberParam(url('/stats'), 'year')).toBeNull();
  });

  it('returns null for a year outside the allow-list', () => {
    expect(readNumberParam(url('/stats?year=2024'), 'year', [2024, 2025])).toBe(2024);
    expect(readNumberParam(url('/stats?year=1999'), 'year', [2024, 2025])).toBeNull();
  });
});

describe('withParam', () => {
  it('sets a key on a URL without a query string', () => {
    expect(withParam(url('/stats'), 'year', 2024)).toBe('/stats?year=2024');
  });

  it('replaces an existing value and keeps the others', () => {
    expect(withParam(url('/stats?year=2023&person=p1'), 'year', 2024)).toBe(
      '/stats?year=2024&person=p1',
    );
  });

  it('removes the key for null, undefined and the empty string', () => {
    expect(withParam(url('/stats?year=2024&person=p1'), 'person', null)).toBe('/stats?year=2024');
    expect(withParam(url('/stats?year=2024&person=p1'), 'person', undefined)).toBe(
      '/stats?year=2024',
    );
    expect(withParam(url('/stats?year=2024&person=p1'), 'person', '')).toBe('/stats?year=2024');
  });

  it('drops the "?" entirely once the last param is removed', () => {
    expect(withParam(url('/stats?year=2024'), 'year', null)).toBe('/stats');
  });

  it('leaves the URL unchanged when removing an absent key', () => {
    expect(withParam(url('/stats?year=2024'), 'person', null)).toBe('/stats?year=2024');
  });

  it('encodes values that need it', () => {
    expect(withParam(url('/stats'), 'person', 'a b&c')).toBe('/stats?person=a+b%26c');
  });
});
