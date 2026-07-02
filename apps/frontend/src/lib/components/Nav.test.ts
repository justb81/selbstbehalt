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
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Nav from './Nav.svelte';

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

  it('navigates via goto when an overflow menu item is clicked', async () => {
    const { goto } = await import('$app/navigation');
    const user = userEvent.setup();
    nav.pathname = '/';
    render(Nav);

    await user.click(screen.getByRole('button', { name: /Mehr/i }));
    const personenItem = screen.queryByRole('menuitem', { name: 'Personen' });
    if (personenItem) {
      await user.click(personenItem);
      expect(goto).toHaveBeenCalled();
    }
  });
});
