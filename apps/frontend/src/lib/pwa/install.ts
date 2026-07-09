// SPDX-License-Identifier: Apache-2.0
/**
 * PWA install-prompt capture (issue #27). Modern Chromium browsers no longer
 * show an automatic install banner on load — they fire `beforeinstallprompt`,
 * which the page must capture and later replay via `prompt()` from a user
 * gesture. This module stashes that deferred event behind a reactive
 * `installAvailable` store and exposes `promptInstall()` to open the native
 * install dialog from our own UI (PwaStatus surfaces it as a toast).
 *
 * The event never fires on iOS Safari (no `beforeinstallprompt`) or once the
 * app is already installed — both simply leave `installAvailable` false, so no
 * prompt is shown.
 *
 * A "Nicht jetzt" dismissal is remembered in `sessionStorage` so the toast
 * doesn't reappear on every reload within the same browser session; a new app
 * update (see `resetInstallDismissal`) clears it so the ask can resurface.
 */
import { browser } from '$app/environment';
import { writable, type Readable } from 'svelte/store';

/**
 * The `beforeinstallprompt` event — not part of the TS DOM lib. Only the
 * members we use are typed.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'selbstbehalt:pwa-install-dismissed';

const availableStore = writable(false);

/** `true` while a captured install prompt is ready to be shown to the user. */
export const installAvailable: Readable<boolean> = { subscribe: availableStore.subscribe };

let deferred: BeforeInstallPromptEvent | null = null;
let initialised = false;

/** Whether "Nicht jetzt" was already clicked during this browser session. */
function isDismissedThisSession(): boolean {
  if (!browser) return false;
  try {
    return sessionStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Start listening for `beforeinstallprompt` (once). Idempotent and a no-op
 * outside the browser.
 */
export function initInstallPrompt(): void {
  if (initialised || !browser) return;
  initialised = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar so our toast drives the flow.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    if (!isDismissedThisSession()) {
      availableStore.set(true);
    }
  });

  // Once installed the prompt can't be replayed; drop it so the toast hides.
  window.addEventListener('appinstalled', () => {
    deferred = null;
    availableStore.set(false);
  });
}

/**
 * Open the native install dialog for the captured prompt. The event is
 * single-use, so the store is cleared before awaiting regardless of the
 * user's choice.
 */
export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const event = deferred;
  deferred = null;
  availableStore.set(false);
  await event.prompt();
  await event.userChoice;
}

/**
 * Dismiss the prompt for the rest of this browser session without installing.
 * Persisted to `sessionStorage` so a reload won't re-ask; the captured event
 * is kept in memory in case `resetInstallDismissal` clears the flag later.
 */
export function dismissInstall(): void {
  availableStore.set(false);
  if (!browser) return;
  try {
    sessionStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Ignore persistence failures (storage disabled, private mode, …).
  }
}

/**
 * Clear a "Nicht jetzt" dismissal so the install prompt can ask again. Called
 * once a new app update is detected (see `PwaStatus.svelte`'s `needRefresh`
 * effect) — a dismissal of a previous version's toast shouldn't silence the
 * prompt for the rest of the session once the app has moved on.
 */
export function resetInstallDismissal(): void {
  if (!browser) return;
  try {
    sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Ignore.
  }
}
