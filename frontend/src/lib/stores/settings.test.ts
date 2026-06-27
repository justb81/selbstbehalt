// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Control PUBLIC_API_URL so base-URL precedence is deterministic.
const mockedEnv = vi.hoisted(() => ({ PUBLIC_API_URL: undefined as string | undefined }));
vi.mock('$env/dynamic/public', () => ({ env: mockedEnv }));

import { resolveApiBaseUrl, settings } from './settings';

const STORAGE_KEY = 'selbstbehalt:settings';

beforeEach(() => {
  localStorage.clear();
  mockedEnv.PUBLIC_API_URL = undefined;
  settings.set({ apiUrl: '' });
});

describe('resolveApiBaseUrl', () => {
  it('prefers an explicit user setting and strips trailing slashes', () => {
    expect(resolveApiBaseUrl({ apiUrl: 'http://nas.local:8080/' })).toBe('http://nas.local:8080');
  });

  it('falls back to PUBLIC_API_URL when no setting is present', () => {
    mockedEnv.PUBLIC_API_URL = 'http://backend:8080';
    expect(resolveApiBaseUrl({ apiUrl: '' })).toBe('http://backend:8080');
  });

  it('falls back to the local-dev default when neither is set', () => {
    expect(resolveApiBaseUrl({ apiUrl: '' })).toBe('http://localhost:8080');
  });

  it('reads the persisted setting from localStorage when called without args', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiUrl: 'http://fromstore:9000' }));
    expect(resolveApiBaseUrl()).toBe('http://fromstore:9000');
  });
});

describe('settings store', () => {
  it('starts from defaults', () => {
    expect(get(settings)).toEqual({ apiUrl: '' });
  });

  it('persists changes to localStorage', () => {
    settings.set({ apiUrl: 'http://persisted:8080' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      apiUrl: 'http://persisted:8080',
    });
  });
});
