// SPDX-License-Identifier: Apache-2.0
/**
 * Glue between the typed API client (#19) and the {@link OfflineQueue} (issue
 * #27). A write that fails because the device is offline is persisted and a
 * {@link OfflineQueuedError} is thrown so the UI can say "saved, will sync"
 * rather than show a hard failure. Reads are never queued.
 */
import { ApiError } from '$lib/api/errors.js';
import type { ApiRequester, RequestOptions } from '$lib/api/client.js';

import { OfflineQueue, type FlushResult, type QueuedWrite } from './queue.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

/**
 * Thrown when a write is parked in the offline queue. `status` stays 0 (it never
 * reached the server) and `queued` marks it so callers can branch on it.
 */
export class OfflineQueuedError extends ApiError {
  readonly queued = true as const;
  constructor(public readonly write: QueuedWrite) {
    super('Offline – Änderung gespeichert und wird bei Verbindung synchronisiert.', 0);
    this.name = 'OfflineQueuedError';
  }
}

/** A network-level failure (status 0) means the request never reached the server. */
function isOfflineFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/**
 * A replay failure is *permanent* (drop the write) for a 4xx client error other
 * than 408/429; transient (keep and retry) for offline (0), 5xx, and throttling.
 */
export function isPermanentApiFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const { status } = error;
  if (status >= 400 && status < 500) return status !== 408 && status !== 429;
  return false;
}

export interface WrapOptions {
  /** Called after a write is enqueued (e.g. to refresh the pending-count store). */
  onEnqueue?: (write: QueuedWrite) => void;
}

/**
 * Wrap an {@link ApiRequester} so offline writes are queued instead of failing.
 * The signature is preserved; queued writes reject with {@link OfflineQueuedError}.
 */
export function wrapWithOfflineQueue(
  request: ApiRequester,
  queue: OfflineQueue,
  options: WrapOptions = {},
): ApiRequester {
  return async function offlineAwareRequest<T = void>(
    path: string,
    opts: RequestOptions<T> = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET';
    if (!WRITE_METHODS.has(method)) return request<T>(path, opts);

    try {
      return await request<T>(path, opts);
    } catch (error) {
      if (!isOfflineFailure(error)) throw error;
      let write: QueuedWrite;
      try {
        write = await queue.enqueue({
          method: method as QueuedWrite['method'],
          path,
          body: opts.body,
        });
      } catch {
        // Persistence is unavailable (IndexedDB disabled/private mode) — we
        // cannot queue, so surface the original offline failure.
        throw error;
      }
      options.onEnqueue?.(write);
      throw new OfflineQueuedError(write);
    }
  };
}

/**
 * Replay every queued write through `request`, in FIFO order. A permanent
 * rejection drops the write; a transient one stops the run for a later retry.
 */
export function replayQueue(request: ApiRequester, queue: OfflineQueue): Promise<FlushResult> {
  return queue.flush((write) => request(write.path, { method: write.method, body: write.body }), {
    isPermanent: isPermanentApiFailure,
  });
}
