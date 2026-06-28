// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiRequester } from '$lib/api/client.js';

import { OfflineQueue, createMemoryStore } from './queue.js';
import { initOfflineSync, isOnline, notifyEnqueued, pendingWrites } from './sync.js';

function makeQueue() {
  let counter = 0;
  return new OfflineQueue(createMemoryStore(), {
    newId: () => `id-${++counter}`,
    now: () => '2026-06-28T00:00:00.000Z',
  });
}

/** Flush microtasks so store-backed store updates settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('initOfflineSync', () => {
  let teardown: () => void = () => {};
  afterEach(() => teardown());

  it('reflects the initial pending count', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/a' });
    // The initial online flush would otherwise drain the queue; make replay fail
    // (transient) so the entry — and the count — survive for the assertion.
    const request = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as ApiRequester;

    teardown = initOfflineSync(request, queue);
    await tick();
    expect(get(pendingWrites)).toBe(1);
  });

  it('tracks connectivity via online/offline events', async () => {
    const queue = makeQueue();
    teardown = initOfflineSync(vi.fn() as unknown as ApiRequester, queue);

    window.dispatchEvent(new Event('offline'));
    expect(get(isOnline)).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(get(isOnline)).toBe(true);
  });

  it('replays the queue when connectivity returns', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/a', body: { n: 1 } });
    const request = vi.fn(async () => undefined) as unknown as ApiRequester;

    teardown = initOfflineSync(request, queue);
    await tick();

    window.dispatchEvent(new Event('online'));
    await tick();

    expect(request).toHaveBeenCalledWith('/api/a', { method: 'POST', body: { n: 1 } });
    expect(get(pendingWrites)).toBe(0);
  });

  it('stops listening after teardown', () => {
    const queue = makeQueue();
    const cleanup = initOfflineSync(vi.fn() as unknown as ApiRequester, queue);
    cleanup();
    window.dispatchEvent(new Event('offline'));
    // The store keeps its last value; the listener no longer flips it.
    expect(get(isOnline)).toBe(true);
  });
});

describe('notifyEnqueued', () => {
  it('increments the pending-writes store', () => {
    const before = get(pendingWrites);
    notifyEnqueued();
    expect(get(pendingWrites)).toBe(before + 1);
  });
});
