// SPDX-License-Identifier: Apache-2.0
/**
 * Test double for `virtual:pwa-register/svelte`. The virtual module only exists
 * when the PWA plugin runs (build/dev), so vitest aliases this stub in its place
 * (see vitest.config.ts) — it returns inert stores so components that register
 * the worker render the "no update / not yet offline-ready" state.
 */
import { writable, type Writable } from 'svelte/store';

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(options: RegisterSWOptions = {}): {
  needRefresh: Writable<boolean>;
  offlineReady: Writable<boolean>;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  // Mirror the real hook's "registered, nothing waiting" callback so callers
  // exercise their onRegisteredSW branch (no real worker is involved in tests).
  options.onRegisteredSW?.('/service-worker.js', undefined);
  return {
    needRefresh: writable(false),
    offlineReady: writable(false),
    updateServiceWorker: async () => {},
  };
}
