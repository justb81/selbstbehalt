// SPDX-License-Identifier: Apache-2.0
//
// Public entry point for the offline write-queue (issue #27).

export {
  OfflineQueue,
  createMemoryStore,
  type QueuedWrite,
  type QueueStore,
  type EnqueueInput,
  type FlushResult,
  type FlushOptions,
} from './queue.js';
export { createIndexedDbStore } from './store-indexeddb.js';
export {
  OfflineQueuedError,
  isPermanentApiFailure,
  wrapWithOfflineQueue,
  replayQueue,
} from './integration.js';
export { isOnline, pendingWrites, initOfflineSync, notifyEnqueued } from './sync.js';
