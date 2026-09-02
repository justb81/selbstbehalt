// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
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

// Issue #461: the overflow entries used to be `onclick={() => goto(...)}`, which
// loses middle-click, "open in new tab", the context menu and prefetch. They are
// real anchors now; the ARIA role stays `menuitem`, because `role="link"` inside
// a `role="menu"` breaks axe's `aria-required-children`.
//
// Queried with `hidden: true` and keyed by text rather than by accessible name:
// bits-ui's floating content starts off-screen with `visibility: hidden` in
// jsdom, which makes the computed accessible name come back empty.
async function openOverflow() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Mehr/i }));
  const items = await screen.findAllByRole('menuitem', { hidden: true });
  return new Map(items.map((item) => [item.textContent?.trim() ?? '', item]));
}

describe('Nav', () => {
  it('renders primary nav links and the overflow trigger', () => {
    nav.pathname = '/';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Auswertung' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Erfassen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mehr/i })).toBeInTheDocument();
  });

  it('marks the home link active only on the exact root path', () => {
    nav.pathname = '/';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rechnungen' })).not.toHaveAttribute('aria-current');
  });

  it('marks a primary section active for its sub-routes', () => {
    nav.pathname = '/invoices/new';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('does not mark a primary link active when an overflow section is active', () => {
    nav.pathname = '/contracts/new';
    render(Nav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Rechnungen' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Auswertung' })).not.toHaveAttribute('aria-current');
  });

  it('renders overflow entries as real anchors with an href', async () => {
    nav.pathname = '/';
    render(Nav);
    const items = await openOverflow();

    for (const [label, href] of [
      ['Personen', '/persons'],
      ['Verträge', '/contracts'],
      ['Versicherte', '/insured'],
      ['Einstellungen', '/settings'],
    ] as const) {
      const item = items.get(label);
      expect(item, `overflow entry ${label}`).toBeDefined();
      expect(item!.tagName).toBe('A');
      expect(item!).toHaveAttribute('href', href);
    }
  });

  it('marks the active overflow entry with aria-current', async () => {
    nav.pathname = '/contracts/new';
    render(Nav);
    const items = await openOverflow();

    expect(items.get('Verträge')).toHaveAttribute('aria-current', 'page');
    expect(items.get('Personen')).not.toHaveAttribute('aria-current');
  });
});
