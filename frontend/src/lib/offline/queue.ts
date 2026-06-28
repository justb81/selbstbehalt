// SPDX-License-Identifier: Apache-2.0
/**
 * Offline write-queue (docs/design.md §1.3 offline-first, §6.3; issue #27).
 *
 * When a write (POST/PUT/DELETE) cannot reach the backend, it is persisted here
 * and replayed in FIFO order once connectivity returns (via the `online` event
 * and a Background Sync nudge from the service worker). The queue logic is
 * storage-agnostic: it talks to a {@link QueueStore}, so it is unit-tested
 * against an in-memory store and runs against IndexedDB in the browser.
 */

/** A persisted write awaiting replay. */
export interface QueuedWrite {
  /** Stable client-side id, used to remove the entry after a successful replay. */
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  /** Request path relative to the API base URL, e.g. `/api/invoices`. */
  path: string;
  /** JSON request body, if any. */
  body?: unknown;
  /** ISO-8601 instant the write was enqueued (for display/debugging). */
  enqueuedAt: string;
}

/** Persistence boundary for the queue; `all()` returns entries in FIFO order. */
export interface QueueStore {
  add(item: QueuedWrite): Promise<void>;
  all(): Promise<QueuedWrite[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface EnqueueInput {
  method: QueuedWrite['method'];
  path: string;
  body?: unknown;
}

export interface FlushResult {
  /** Number of queued writes successfully sent (or permanently dropped). */
  flushed: number;
  /** Number still queued afterwards (a transient failure stops the run). */
  remaining: number;
}

export interface FlushOptions {
  /**
   * Classifies a replay failure. `true` → the write is dropped (a permanent
   * server rejection, e.g. 4xx); `false`/omitted → kept and the run stops so
   * FIFO order is preserved for the next attempt. Defaults to "never permanent".
   */
  isPermanent?: (error: unknown) => boolean;
}

/** Injected dependencies, so id/timestamp generation is deterministic in tests. */
export interface OfflineQueueDeps {
  /** Generates the {@link QueuedWrite.id}; defaults to `crypto.randomUUID()`. */
  newId?: () => string;
  /** Current instant as ISO-8601; defaults to `new Date().toISOString()`. */
  now?: () => string;
}

export class OfflineQueue {
  private readonly store: QueueStore;
  private readonly newId: () => string;
  private readonly now: () => string;

  constructor(store: QueueStore, deps: OfflineQueueDeps = {}) {
    this.store = store;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Persist a write for later replay; returns the stored entry. */
  async enqueue(input: EnqueueInput): Promise<QueuedWrite> {
    const item: QueuedWrite = {
      id: this.newId(),
      method: input.method,
      path: input.path,
      body: input.body,
      enqueuedAt: this.now(),
    };
    await this.store.add(item);
    return item;
  }

  /** All queued writes, oldest first. */
  pending(): Promise<QueuedWrite[]> {
    return this.store.all();
  }

  /** How many writes are queued. */
  async size(): Promise<number> {
    return (await this.store.all()).length;
  }

  /** Drop every queued write (e.g. after the user discards offline changes). */
  clear(): Promise<void> {
    return this.store.clear();
  }

  /**
   * Replay queued writes in FIFO order via `send`. On a permanent failure the
   * entry is dropped and the run continues; on any other (transient/offline)
   * failure the run stops, leaving that entry and the rest for a later attempt.
   */
  async flush(
    send: (write: QueuedWrite) => Promise<void>,
    options: FlushOptions = {},
  ): Promise<FlushResult> {
    const isPermanent = options.isPermanent ?? (() => false);
    const items = await this.store.all();
    let flushed = 0;

    for (const item of items) {
      try {
        await send(item);
        await this.store.remove(item.id);
        flushed++;
      } catch (error) {
        if (isPermanent(error)) {
          await this.store.remove(item.id);
          flushed++;
          continue;
        }
        break; // transient — preserve order, retry on the next flush
      }
    }

    const remaining = (await this.store.all()).length;
    return { flushed, remaining };
  }
}

/** A simple in-memory {@link QueueStore} — used by tests and as an SSR no-op. */
export function createMemoryStore(): QueueStore {
  let items: QueuedWrite[] = [];
  return {
    async add(item) {
      items.push(item);
    },
    async all() {
      return [...items];
    },
    async remove(id) {
      items = items.filter((item) => item.id !== id);
    },
    async clear() {
      items = [];
    },
  };
}
