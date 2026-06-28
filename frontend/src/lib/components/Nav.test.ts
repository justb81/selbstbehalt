// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

// Mutable mock of SvelteKit's $app/state page store; tests set `nav.pathname`.
const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL(`http://localhost${nav.pathname}`);
    },
  },
}));

import Nav from './Nav.svelte';

describe('Nav', () => {
  it('renders a link for every top-level section', () => {
    nav.pathname = '/';
    render(Nav);
    for (const label of [
      'Dashboard',
      'Personen',
      'Verträge',
      'Rechnungen',
      'Auswertung',
      'Einstellungen',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the home link active only on the exact root path', () => {
    nav.pathname = '/';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Verträge' })).not.toHaveAttribute('aria-current');
  });

  it('marks a section active for its sub-routes', () => {
    nav.pathname = '/contracts/new';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Verträge' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
});
