// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import PwaStatus from './PwaStatus.svelte';
import { initPwa } from '$lib/pwa/register.js';

// `initPwa()` memoises a single controller module-wide; reset both flags before
// each test so state set by one test can't leak into the next.
beforeEach(() => {
  const { needRefresh, offlineReady } = initPwa();
  needRefresh.set(false);
  offlineReady.set(false);
});

describe('PwaStatus', () => {
  it('renders nothing by default', () => {
    render(PwaStatus);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the reload hint when an update is waiting', async () => {
    render(PwaStatus);
    initPwa().needRefresh.set(true);
    expect(await screen.findByText('Eine neue Version ist verfügbar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
  });

  it('shows the offline-ready confirmation once the shell is cached', async () => {
    render(PwaStatus);
    initPwa().offlineReady.set(true);
    expect(await screen.findByText('App ist offline einsatzbereit.')).toBeInTheDocument();
  });
});
