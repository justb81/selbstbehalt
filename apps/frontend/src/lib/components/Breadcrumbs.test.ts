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
vi.mock('$app/paths', () => ({ base: '' }));

import Breadcrumbs from './Breadcrumbs.svelte';

describe('Breadcrumbs', () => {
  it('renders nothing on top-level pages', () => {
    nav.pathname = '/';
    const { container } = render(Breadcrumbs);
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).not.toBeInTheDocument();
  });

  it('renders nothing on a section root', () => {
    nav.pathname = '/invoices';
    const { container } = render(Breadcrumbs);
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).not.toBeInTheDocument();
  });

  it('shows section link and "Neue Rechnung" on /invoices/new', () => {
    nav.pathname = '/invoices/new';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Neue Rechnung')).toBeInTheDocument();
  });

  it('shows section link and "Scan" on /invoices/scan', () => {
    nav.pathname = '/invoices/scan';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Scan')).toBeInTheDocument();
  });

  it('shows section and entity on /invoices/[id]', () => {
    nav.pathname = '/invoices/abc-123';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Rechnung')).toBeInTheDocument();
  });

  it('shows three crumbs on /invoices/[id]/edit', () => {
    nav.pathname = '/invoices/abc-123/edit';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rechnung' })).toBeInTheDocument();
    expect(screen.getByText('Bearbeiten')).toBeInTheDocument();
  });

  it('shows three crumbs on /invoices/[id]/submit', () => {
    nav.pathname = '/invoices/abc-123/submit';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rechnung' })).toBeInTheDocument();
    expect(screen.getByText('Einreichen')).toBeInTheDocument();
  });

  it('shows breadcrumbs for /contracts/new', () => {
    nav.pathname = '/contracts/new';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Verträge' })).toBeInTheDocument();
    expect(screen.getByText('Neuer Vertrag')).toBeInTheDocument();
  });

  it('shows breadcrumbs for /persons/[id]', () => {
    nav.pathname = '/persons/some-uuid';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Personen' })).toBeInTheDocument();
    expect(screen.getByText('Person')).toBeInTheDocument();
  });
});
