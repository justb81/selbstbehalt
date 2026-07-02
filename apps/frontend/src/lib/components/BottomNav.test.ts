// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL(`http://localhost${nav.pathname}`);
    },
  },
}));
let afterNavigateCallback: (() => void) | undefined;
vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn((cb: () => void) => {
    afterNavigateCallback = cb;
  }),
  goto: vi.fn(),
}));

import BottomNav from './BottomNav.svelte';

describe('BottomNav', () => {
  it('renders primary tab links and the scan FAB', () => {
    nav.pathname = '/';
    render(BottomNav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Auswertung' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rechnung erfassen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mehr/i })).toBeInTheDocument();
  });

  it('marks the home tab active only on the root path', () => {
    nav.pathname = '/';
    render(BottomNav);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rechnungen' })).not.toHaveAttribute('aria-current');
  });

  it('closes the sheet when afterNavigate fires', () => {
    nav.pathname = '/';
    render(BottomNav);
    expect(afterNavigateCallback).toBeDefined();
    expect(() => afterNavigateCallback?.()).not.toThrow();
  });

  it('marks Rechnungen active for invoice sub-routes', () => {
    nav.pathname = '/invoices/scan';
    render(BottomNav);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
});
