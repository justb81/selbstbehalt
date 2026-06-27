// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet, type Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

// The settings page reads SvelteKit's $env/dynamic/public (via the settings
// store) — stub it so the import graph loads under vitest.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

// Shared mock of SvelteKit's $app/state for route components that read it.
const state = vi.hoisted(() => ({
  pathname: '/',
  status: 404,
  error: { message: 'Nicht gefunden' } as { message: string } | null,
  params: { id: 'c-1' } as Record<string, string>,
}));
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL(`http://localhost${state.pathname}`);
    },
    get status() {
      return state.status;
    },
    get error() {
      return state.error;
    },
    get params() {
      return state.params;
    },
  },
}));

import Dashboard from './+page.svelte';
import ErrorPage from './+error.svelte';
import Layout from './+layout.svelte';
import ContractDetail from './contracts/[id]/+page.svelte';
import NewContract from './contracts/new/+page.svelte';
import Contracts from './contracts/+page.svelte';
import InvoiceDetail from './invoices/[id]/+page.svelte';
import SubmitInvoice from './invoices/[id]/submit/+page.svelte';
import Scan from './invoices/scan/+page.svelte';
import Invoices from './invoices/+page.svelte';
import Settings from './settings/+page.svelte';
import Stats from './stats/+page.svelte';

const pages: Array<{ name: string; Component: Component<Record<string, never>>; heading: string }> =
  [
    { name: 'Dashboard', Component: Dashboard, heading: 'Dashboard' },
    { name: 'Verträge', Component: Contracts, heading: 'Verträge' },
    { name: 'Neuer Vertrag', Component: NewContract, heading: 'Neuer Vertrag' },
    { name: 'Vertragsdetail', Component: ContractDetail, heading: 'Vertragsdetail' },
    { name: 'Rechnungen', Component: Invoices, heading: 'Rechnungen' },
    { name: 'Rechnung scannen', Component: Scan, heading: 'Rechnung scannen' },
    { name: 'Rechnungsdetail', Component: InvoiceDetail, heading: 'Rechnungsdetail' },
    { name: 'Einreichung', Component: SubmitInvoice, heading: 'Einreichung' },
    { name: 'Auswertung', Component: Stats, heading: 'Auswertung' },
    { name: 'Einstellungen', Component: Settings, heading: 'Einstellungen' },
  ];

describe('route pages (§6.1)', () => {
  it.each(pages)('$name renders its level-1 heading', ({ Component, heading }) => {
    render(Component);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
});

describe('root layout', () => {
  it('wraps page content in the app shell', () => {
    const children = createRawSnippet(() => ({ render: () => `<p>Seiteninhalt</p>` }));
    render(Layout, { props: { children } });
    expect(screen.getByRole('link', { name: 'selbstbehalt' })).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
  });
});

describe('error page', () => {
  it('renders the status and message', () => {
    state.status = 404;
    state.error = { message: 'Nicht gefunden' };
    render(ErrorPage);
    expect(screen.getByRole('heading', { name: 'Fehler 404' })).toBeInTheDocument();
    expect(screen.getByText('Nicht gefunden')).toBeInTheDocument();
  });

  it('falls back to a generic message when none is provided', () => {
    state.status = 500;
    state.error = null;
    render(ErrorPage);
    expect(screen.getByText('Die Seite konnte nicht geladen werden.')).toBeInTheDocument();
  });
});
