// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control PUBLIC_API_URL so base-URL precedence is deterministic.
const mockedEnv = vi.hoisted(() => ({ PUBLIC_API_URL: undefined as string | undefined }));
vi.mock('$env/dynamic/public', () => ({ env: mockedEnv }));

import { resolveApiBaseUrl, settings, type Settings } from './settings';

const STORAGE_KEY = 'selbstbehalt:settings';

const defaults: Settings = {
  apiUrl: '',
  apiKey: '',
  taxRate: 0.25,
  discountRate: 0.03,
  claimFreeProbability: 0.7,
};

beforeEach(() => {
  localStorage.clear();
  mockedEnv.PUBLIC_API_URL = undefined;
  settings.set(defaults);
});

describe('resolveApiBaseUrl', () => {
  it('prefers an explicit user setting and strips trailing slashes', () => {
    expect(resolveApiBaseUrl({ ...defaults, apiUrl: 'http://nas.local:8080/' })).toBe(
      'http://nas.local:8080',
    );
  });

  it('falls back to PUBLIC_API_URL when no setting is present', () => {
    mockedEnv.PUBLIC_API_URL = 'http://backend:8080';
    expect(resolveApiBaseUrl({ ...defaults, apiUrl: '' })).toBe('http://backend:8080');
  });

  it('falls back to same-origin (empty base) when neither a setting nor PUBLIC_API_URL is set', () => {
    expect(resolveApiBaseUrl({ ...defaults, apiUrl: '' })).toBe('');
  });

  it('defaults to the live store value (not a fresh localStorage read) when called without args', () => {
    settings.set({ ...defaults, apiUrl: 'http://fromstore:9000' });
    expect(resolveApiBaseUrl()).toBe('http://fromstore:9000');
  });
});

describe('settings store', () => {
  it('starts from defaults', () => {
    expect(get(settings)).toEqual(defaults);
  });

  it('persists changes to localStorage', () => {
    const updated = { ...defaults, apiUrl: 'http://persisted:8080' };
    settings.set(updated);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(updated);
  });
});
