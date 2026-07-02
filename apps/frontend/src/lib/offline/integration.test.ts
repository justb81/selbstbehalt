// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '$lib/api/errors.js';
import type { ApiRequester } from '$lib/api/client.js';

import {
  OfflineQueuedError,
  isPermanentApiFailure,
  replayQueue,
  wrapWithOfflineQueue,
} from './integration.js';
import { OfflineQueue, createMemoryStore } from './queue.js';

function makeQueue() {
  let counter = 0;
  return new OfflineQueue(createMemoryStore(), {
    newId: () => `id-${++counter}`,
    now: () => '2026-06-28T00:00:00.000Z',
  });
}

describe('wrapWithOfflineQueue', () => {
  it('passes reads straight through without touching the queue', async () => {
    const queue = makeQueue();
    const request = vi.fn(async () => ({ ok: true })) as unknown as ApiRequester;
    const wrapped = wrapWithOfflineQueue(request, queue);

    await expect(wrapped('/api/invoices')).resolves.toEqual({ ok: true });
    expect(await queue.size()).toBe(0);
  });

  it('returns a successful write result unchanged', async () => {
    const queue = makeQueue();
    const request = vi.fn(async () => ({ id: '1' })) as unknown as ApiRequester;
    const wrapped = wrapWithOfflineQueue(request, queue);

    await expect(wrapped('/api/invoices', { method: 'POST', body: { x: 1 } })).resolves.toEqual({
      id: '1',
    });
    expect(await queue.size()).toBe(0);
  });

  it('queues an offline write and rejects with OfflineQueuedError', async () => {
    const queue = makeQueue();
    const onEnqueue = vi.fn();
    const request = vi.fn(async () => {
      throw new ApiError('Verbindung fehlgeschlagen', 0);
    }) as unknown as ApiRequester;
    const wrapped = wrapWithOfflineQueue(request, queue, { onEnqueue });

    await expect(
      wrapped('/api/invoices', { method: 'POST', body: { x: 1 } }),
    ).rejects.toBeInstanceOf(OfflineQueuedError);
    expect(onEnqueue).toHaveBeenCalledOnce();
    const pending = await queue.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ method: 'POST', path: '/api/invoices', body: { x: 1 } });
  });

  it('rethrows a server error (non-offline) without queuing', async () => {
    const queue = makeQueue();
    const request = vi.fn(async () => {
      throw new ApiError('Konflikt', 409);
    }) as unknown as ApiRequester;
    const wrapped = wrapWithOfflineQueue(request, queue);

    await expect(wrapped('/api/invoices', { method: 'PUT', body: {} })).rejects.toMatchObject({
      status: 409,
    });
    expect(await queue.size()).toBe(0);
  });
});

describe('isPermanentApiFailure', () => {
  it('treats most 4xx as permanent but keeps 408/429 and offline/5xx transient', () => {
    expect(isPermanentApiFailure(new ApiError('bad', 400))).toBe(true);
    expect(isPermanentApiFailure(new ApiError('conflict', 409))).toBe(true);
    expect(isPermanentApiFailure(new ApiError('timeout', 408))).toBe(false);
    expect(isPermanentApiFailure(new ApiError('throttled', 429))).toBe(false);
    expect(isPermanentApiFailure(new ApiError('offline', 0))).toBe(false);
    expect(isPermanentApiFailure(new ApiError('server', 503))).toBe(false);
    expect(isPermanentApiFailure(new Error('plain'))).toBe(false);
  });
});

describe('replayQueue', () => {
  it('replays queued writes through the requester in FIFO order', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/a', body: { n: 1 } });
    await queue.enqueue({ method: 'DELETE', path: '/api/b' });

    const calls: Array<[string, string | undefined]> = [];
    const request = (async (path: string, opts?: { method?: string }) => {
      calls.push([path, opts?.method]);
    }) as unknown as ApiRequester;

    const result = await replayQueue(request, queue);
    expect(result).toEqual({ flushed: 2, remaining: 0 });
    expect(calls).toEqual([
      ['/api/a', 'POST'],
      ['/api/b', 'DELETE'],
    ]);
  });

  it('drops a write the server permanently rejects and keeps a transient one', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/permanent' });
    await queue.enqueue({ method: 'POST', path: '/api/transient' });

    const request = (async (path: string) => {
      if (path === '/api/permanent') throw new ApiError('unprocessable', 422);
      throw new ApiError('offline', 0);
    }) as unknown as ApiRequester;

    const result = await replayQueue(request, queue);
    // permanent dropped (counts as flushed), transient stops the run and stays.
    expect(result).toEqual({ flushed: 1, remaining: 1 });
    expect((await queue.pending()).map((w) => w.path)).toEqual(['/api/transient']);
  });
});
