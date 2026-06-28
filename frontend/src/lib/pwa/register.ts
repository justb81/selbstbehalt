// SPDX-License-Identifier: Apache-2.0
/**
 * Service-worker registration + update flow (issue #27). Wraps the
 * `virtual:pwa-register/svelte` hook from @vite-pwa/sveltekit into a single
 * memoised controller exposing reactive `needRefresh`/`offlineReady` stores and
 * `updateServiceWorker()`, which posts SKIP_WAITING and reloads.
 *
 * In `vitest` the virtual module is aliased to `./register-stub` (see
 * vitest.config.ts), so components using this stay unit-testable.
 */
import { useRegisterSW } from 'virtual:pwa-register/svelte';
import type { Writable } from 'svelte/store';

export interface PwaController {
  /** True once an updated worker is waiting and the user should reload. */
  needRefresh: Writable<boolean>;
  /** True once the app shell has been cached and works offline. */
  offlineReady: Writable<boolean>;
  /** Activate the waiting worker; `reloadPage` reloads the tab once it is live. */
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

/** How often to poll for a new worker while the app stays open (1 h). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let controller: PwaController | null = null;

/** Register the service worker (once) and return the update-flow controller. */
export function initPwa(): PwaController {
  if (controller) return controller;
  controller = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Periodically check for a freshly deployed worker so long-lived tabs
      // eventually surface the reload hint without a manual refresh.
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });
  return controller;
}
