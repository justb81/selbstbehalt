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

const availableStore = writable(false);

/** `true` while a captured install prompt is ready to be shown to the user. */
export const installAvailable: Readable<boolean> = { subscribe: availableStore.subscribe };

let deferred: BeforeInstallPromptEvent | null = null;
let initialised = false;

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
    availableStore.set(true);
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
 * Dismiss the prompt for this session without installing. The captured event is
 * kept, so the prompt can resurface after a reload while it stays valid.
 */
export function dismissInstall(): void {
  availableStore.set(false);
}
