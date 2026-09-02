// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { InvoiceStatusEvent } from '@selbstbehalt/shared';
import InvoiceStatusHistory from './InvoiceStatusHistory.svelte';

const EVENTS: InvoiceStatusEvent[] = [
  {
    id: 'ev-1',
    invoice_id: 'inv-1',
    track: 'review',
    status: 'geprüft',
    changed_at: '2026-03-16T09:30:00Z',
    note: 'Belege geprüft',
  },
  {
    id: 'ev-2',
    invoice_id: 'inv-1',
    track: 'payment',
    status: 'bezahlt',
    changed_at: '2026-03-20',
    note: null,
  },
];

describe('InvoiceStatusHistory', () => {
  it('lists every event with its track label, timestamp and note', () => {
    render(InvoiceStatusHistory, { props: { events: EVENTS, loading: false, error: null } });

    expect(screen.getByText('Statusverlauf')).toBeInTheDocument();
    expect(screen.getByText('Prüfung')).toBeInTheDocument();
    expect(screen.getByText('Zahlung')).toBeInTheDocument();
    expect(screen.getByText('16.03.2026 09:30')).toBeInTheDocument();
    expect(screen.getByText('Belege geprüft')).toBeInTheDocument();
  });

  it('renders a date-only event without a time', () => {
    render(InvoiceStatusHistory, { props: { events: EVENTS, loading: false, error: null } });
    expect(screen.getByText('20.03.2026')).toBeInTheDocument();
  });

  it('announces the loading state instead of an empty trail', () => {
    render(InvoiceStatusHistory, { props: { events: [], loading: true, error: null } });
    expect(screen.getByText('Statusverlauf wird geladen …')).toBeInTheDocument();
  });

  it('shows the load error', () => {
    render(InvoiceStatusHistory, {
      props: { events: [], loading: false, error: 'Netzwerkfehler' },
    });
    expect(screen.getByText('Netzwerkfehler')).toBeInTheDocument();
  });

  it('renders nothing at all when there are no events', () => {
    const { container } = render(InvoiceStatusHistory, {
      props: { events: [], loading: false, error: null },
    });
    expect(container).toHaveTextContent('');
  });
});
