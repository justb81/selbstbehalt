// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

// Control the PUBLIC_API_URL env exposed via SvelteKit's $env/dynamic/public.
const mockedEnv = vi.hoisted(() => ({ PUBLIC_API_URL: undefined as string | undefined }));
vi.mock('$env/dynamic/public', () => ({ env: mockedEnv }));

import { envApiBaseUrl } from './config';

afterEach(() => {
  mockedEnv.PUBLIC_API_URL = undefined;
});

describe('envApiBaseUrl', () => {
  it('returns undefined when PUBLIC_API_URL is unset', () => {
    expect(envApiBaseUrl()).toBeUndefined();
  });

  it('returns undefined when PUBLIC_API_URL is empty/whitespace', () => {
    mockedEnv.PUBLIC_API_URL = '   ';
    expect(envApiBaseUrl()).toBeUndefined();
  });

  it('returns the trimmed value when set', () => {
    mockedEnv.PUBLIC_API_URL = '  http://backend:8080  ';
    expect(envApiBaseUrl()).toBe('http://backend:8080');
  });
});
