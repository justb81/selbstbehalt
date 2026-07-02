// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// AppShell renders Nav, which reads $app/state.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/') },
}));

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
