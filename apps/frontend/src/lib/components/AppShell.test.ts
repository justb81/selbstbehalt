// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// AppShell renders Nav, which reads $app/state.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/') },
}));

// PwaStatus reads the server-reachability state (#381) from $lib/api, which
// resolves the backend base URL from $env/dynamic/public — stub it so the
// import graph loads under vitest.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import AppShell from './AppShell.svelte';

const children = createRawSnippet(() => ({
  render: () => `<p>Seiteninhalt</p>`,
}));

describe('AppShell', () => {
  it('renders the brand, navigation and its children', () => {
    render(AppShell, { props: { children } });

    expect(screen.getByRole('link', { name: 'selbstbehalt' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
  });
});
