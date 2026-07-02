// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { initPwa } from './register.js';

describe('initPwa', () => {
  it('returns a memoised controller with inert stores (via the test stub)', () => {
    const first = initPwa();
    const second = initPwa();

    // Memoised: the service worker is registered at most once per session.
    expect(second).toBe(first);
    expect(get(first.needRefresh)).toBe(false);
    expect(get(first.offlineReady)).toBe(false);
    expect(typeof first.updateServiceWorker).toBe('function');
  });
});
