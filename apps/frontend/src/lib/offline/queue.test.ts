// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { OfflineQueue, createMemoryStore, type QueuedWrite } from './queue.js';

function makeQueue() {
  let counter = 0;
  const queue = new OfflineQueue(createMemoryStore(), {
    newId: () => `id-${++counter}`,
    now: () => '2026-06-28T00:00:00.000Z',
  });
  return queue;
}

describe('OfflineQueue', () => {
  it('enqueues writes and reports them FIFO with a count', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/invoices', body: { a: 1 } });
    await queue.enqueue({ method: 'DELETE', path: '/api/invoices/2' });

    expect(await queue.size()).toBe(2);
    const pending = await queue.pending();
    expect(pending.map((w) => w.path)).toEqual(['/api/invoices', '/api/invoices/2']);
    expect(pending[0]).toMatchObject({
      id: 'id-1',
      method: 'POST',
      enqueuedAt: expect.any(String),
    });
  });

  it('clears the queue', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/x' });
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });

  it('flushes in order and removes each sent write', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/a' });
    await queue.enqueue({ method: 'POST', path: '/api/b' });

    const sent: string[] = [];
    const result = await queue.flush(async (w) => {
      sent.push(w.path);
    });

    expect(sent).toEqual(['/api/a', '/api/b']);
    expect(result).toEqual({ flushed: 2, remaining: 0 });
    expect(await queue.size()).toBe(0);
  });

  it('stops at the first transient failure, preserving order', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/a' });
    await queue.enqueue({ method: 'POST', path: '/api/b' });
    await queue.enqueue({ method: 'POST', path: '/api/c' });

    const send = vi.fn(async (w: QueuedWrite) => {
      if (w.path === '/api/b') throw new Error('offline');
    });
    const result = await queue.flush(send);

    expect(result).toEqual({ flushed: 1, remaining: 2 });
    // a sent+removed; b and c still queued, in order.
    expect((await queue.pending()).map((w) => w.path)).toEqual(['/api/b', '/api/c']);
  });

  it('drops a permanently-failing write and continues', async () => {
    const queue = makeQueue();
    await queue.enqueue({ method: 'POST', path: '/api/bad' });
    await queue.enqueue({ method: 'POST', path: '/api/good' });

    const result = await queue.flush(
      async (w) => {
        if (w.path === '/api/bad') throw new Error('422');
      },
      { isPermanent: (e) => e instanceof Error && e.message === '422' },
    );

    expect(result).toEqual({ flushed: 2, remaining: 0 });
    expect(await queue.size()).toBe(0);
  });
});
