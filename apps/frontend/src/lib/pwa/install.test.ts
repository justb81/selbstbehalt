// SPDX-License-Identifier: Apache-2.0
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import { initInstallPrompt, installAvailable, promptInstall } from './install.js';

/** Build a fake `beforeinstallprompt` event with the members we use. */
function makeInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('install prompt', () => {
  it('captures beforeinstallprompt and replays it via promptInstall', async () => {
    initInstallPrompt();
    // Idempotent: a second init must not double-register listeners.
    initInstallPrompt();

    expect(get(installAvailable)).toBe(false);

    const event = makeInstallEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    // The browser's own banner is suppressed and our store flips on.
    expect(preventDefault).toHaveBeenCalled();
    expect(get(installAvailable)).toBe(true);

    await promptInstall();

    // The native dialog is opened and the single-use prompt is cleared.
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(get(installAvailable)).toBe(false);
  });

  it('clears the captured prompt once the app is installed', () => {
    window.dispatchEvent(makeInstallEvent());
    expect(get(installAvailable)).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));
    expect(get(installAvailable)).toBe(false);
  });

  it('is a no-op when no prompt was captured', async () => {
    // installAvailable is already false here; promptInstall must resolve quietly.
    await expect(promptInstall()).resolves.toBeUndefined();
  });
});
