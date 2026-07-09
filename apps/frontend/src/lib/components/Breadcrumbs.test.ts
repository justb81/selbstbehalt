// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { breadcrumbEntity, setBreadcrumbEntity } from '$lib/stores/breadcrumb';

// The entity label is a module singleton — reset it so state can't leak between tests.
afterEach(() => breadcrumbEntity.set(null));

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

  it('renders nothing on single-segment pages like /stats and /settings', () => {
    for (const pathname of ['/stats', '/settings']) {
      nav.pathname = pathname;
      const { container } = render(Breadcrumbs);
      expect(container.querySelector('nav[aria-label="breadcrumb"]')).not.toBeInTheDocument();
    }
  });

  it('shows section link and "Neue Rechnung" on /invoices/new', () => {
    nav.pathname = '/invoices/new';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Neue Rechnung')).toBeInTheDocument();
  });

  it('shows section and a generic fallback on /invoices/[id] without a set label', () => {
    nav.pathname = '/invoices/abc-123';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Rechnung')).toBeInTheDocument();
  });

  it('shows the real object name on /invoices/[id] when the store is set', () => {
    nav.pathname = '/invoices/abc-123';
    setBreadcrumbEntity('abc-123', 'Dr. Müller');
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByText('Dr. Müller')).toBeInTheDocument();
  });

  it('ignores a stored label that belongs to a different route id', () => {
    nav.pathname = '/insured/abc-123';
    setBreadcrumbEntity('other-id', 'Stale Name');
    render(Breadcrumbs);
    expect(screen.getByText('Versicherte Person')).toBeInTheDocument();
    expect(screen.queryByText('Stale Name')).not.toBeInTheDocument();
  });

  it('links the object crumb and shows "Bearbeiten" on /invoices/[id]/edit', () => {
    nav.pathname = '/invoices/abc-123/edit';
    setBreadcrumbEntity('abc-123', 'Dr. Müller');
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dr. Müller' })).toBeInTheDocument();
    expect(screen.getByText('Bearbeiten')).toBeInTheDocument();
  });

  it('shows "Einreichung" as the action on /invoices/[id]/submit', () => {
    nav.pathname = '/invoices/abc-123/submit';
    render(Breadcrumbs);
    expect(screen.getByRole('link', { name: 'Rechnungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rechnung' })).toBeInTheDocument();
    expect(screen.getByText('Einreichung')).toBeInTheDocument();
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
