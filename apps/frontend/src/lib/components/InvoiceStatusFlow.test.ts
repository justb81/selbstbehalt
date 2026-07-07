// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceWithPositions, InvoiceStatusEvent } from '@selbstbehalt/shared';

vi.mock('$lib/api', () => ({
  api: {
    invoices: {
      events: vi.fn().mockResolvedValue([]),
      changeStatus: vi.fn().mockResolvedValue({}),
      refund: vi.fn().mockResolvedValue({}),
      revert: vi.fn().mockResolvedValue({}),
      getSubmission: vi.fn().mockRejectedValue(new Error('not found')),
    },
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$app/paths', () => ({
  resolve: (pattern: string, params?: Record<string, string>) => {
    if (!params) return pattern;
    return pattern.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? `[${k}]`);
  },
}));

import InvoiceStatusFlow from './InvoiceStatusFlow.svelte';
import { api } from '$lib/api';
import { goto } from '$app/navigation';

const BASE_INVOICE: InvoiceWithPositions = {
  id: 'inv-1',
  insured_person_id: 'ip-1',
  invoice_date: '2025-03-15',
  invoice_number: 'R-2025-042',
  provider_name: 'Dr. Mustermann',
  provider_type: 'arzt',
  total_amount: 100.0,
  eligible_amount: 80.0,
  self_paid_amount: 0,
  status: 'neu',
  notes: null,
  ocr_raw: null,
  created_at: '2025-03-15T10:00:00Z',
  positions: [
    {
      id: 'pos-1',
      invoice_id: 'inv-1',
      goae_number: '1',
      goae_category: 'GOÄ',
      quantity: 1,
      treatment_date: '2025-03-15',
      description: 'Beratung',
      multiplier: 2.3,
      base_amount: 4.66,
      charged_amount: 10.73,
      eligible_amount: 8.5,
      refund_amount: null,
      is_valid: true,
      flag_reason: null,
    },
  ],
};

describe('InvoiceStatusFlow', () => {
  it('renders the current status badge', async () => {
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });
    expect(await screen.findByText('Neu')).toBeInTheDocument();
  });

  it('shows "Als geprüft markieren" for status neu', async () => {
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });
    expect(
      await screen.findByRole('button', { name: 'Als geprüft markieren' }),
    ).toBeInTheDocument();
  });

  it('calls changeStatus and onChanged when "Als geprüft markieren" is clicked', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged } });

    await user.click(await screen.findByRole('button', { name: 'Als geprüft markieren' }));

    await waitFor(() =>
      expect(api.invoices.changeStatus).toHaveBeenCalledWith('inv-1', { status: 'geprüft' }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows "Zurück zu Neu" and "Als bezahlt markieren" for status geprüft', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'geprüft' }, onChanged: vi.fn() },
    });
    expect(await screen.findByRole('button', { name: 'Zurück zu Neu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Als bezahlt markieren' })).toBeInTheDocument();
  });

  it('calls changeStatus with neu when "Zurück zu Neu" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'geprüft' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Zurück zu Neu' }));

    await waitFor(() =>
      expect(api.invoices.changeStatus).toHaveBeenCalledWith('inv-1', { status: 'neu' }),
    );
  });

  it('shows "Einreichen …" for status bezahlt', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'bezahlt' }, onChanged: vi.fn() },
    });
    expect(await screen.findByRole('button', { name: 'Einreichen …' })).toBeInTheDocument();
  });

  it('navigates to submit page when "Einreichen …" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'bezahlt' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Einreichen …' }));

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/invoices/inv-1/submit'));
  });

  it('shows "Erstattung erfassen" for status eingereicht', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });
    expect(await screen.findByRole('button', { name: 'Erstattung erfassen' })).toBeInTheDocument();
  });

  it('opens the refund form when "Erstattung erfassen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    expect(await screen.findByText('Erstattungsbeträge je Position erfassen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erstattung speichern' })).toBeInTheDocument();
  });

  it('pre-fills refund_amount with eligible_amount in the refund form', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    const input = await screen.findByLabelText(/Erstattungsbetrag für Position 1/);
    expect((input as HTMLInputElement).value).toBe('8.5');
  });

  it('calls the refund API when the refund form is submitted', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    await user.click(screen.getByRole('button', { name: 'Erstattung speichern' }));

    await waitFor(() =>
      expect(api.invoices.refund).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({
          positions: [{ id: 'pos-1', refund_amount: 8.5 }],
        }),
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('closes the refund form when Abbrechen is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    expect(screen.getByText('Erstattungsbeträge je Position erfassen')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByText('Erstattungsbeträge je Position erfassen')).not.toBeInTheDocument();
  });

  it('shows no transition buttons for status erstattet', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'erstattet' }, onChanged: vi.fn() },
    });
    await waitFor(() => expect(screen.getByText('Erstattet')).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /markieren|erfassen|einreichen/i }),
    ).not.toBeInTheDocument();
  });

  it('loads and displays status event history', async () => {
    const events: InvoiceStatusEvent[] = [
      {
        id: 'ev-1',
        invoice_id: 'inv-1',
        status: 'neu',
        changed_at: '2025-03-15T10:00:00Z',
        note: null,
      },
      {
        id: 'ev-2',
        invoice_id: 'inv-1',
        status: 'geprüft',
        changed_at: '2025-03-16T09:00:00Z',
        note: 'Belege geprüft',
      },
    ];
    vi.mocked(api.invoices.events).mockResolvedValueOnce(events);

    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });

    await waitFor(() => expect(screen.getByText('Statusverlauf')).toBeInTheDocument());
    expect(screen.getByText('Belege geprüft')).toBeInTheDocument();
  });

  it('shows an error alert when a status change fails', async () => {
    vi.mocked(api.invoices.changeStatus).mockRejectedValueOnce(new Error('Netzwerkfehler'));
    const user = userEvent.setup();

    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });

    await user.click(await screen.findByRole('button', { name: 'Als geprüft markieren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Netzwerkfehler');
  });

  it('shows an error alert when the refund API call fails', async () => {
    vi.mocked(api.invoices.refund).mockRejectedValueOnce(new Error('Erstattungsfehler'));
    const user = userEvent.setup();

    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    await user.click(screen.getByRole('button', { name: 'Erstattung speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Erstattungsfehler');
  });

  it('shows "Keine Positionen vorhanden" in refund form when invoice has no positions', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: {
        invoice: { ...BASE_INVOICE, status: 'eingereicht', positions: [] },
        onChanged: vi.fn(),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    expect(await screen.findByText('Keine Positionen vorhanden.')).toBeInTheDocument();
  });
});

describe('Letzter Schritt (issue #230)', () => {
  it('shows no "Letzter Schritt" section for status neu', async () => {
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });
    await screen.findByText('Neu');
    expect(screen.queryByText('Letzter Schritt')).not.toBeInTheDocument();
  });

  it('shows only "Löschen" (no "Bearbeiten") for status bezahlt', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'bezahlt' }, onChanged: vi.fn() },
    });
    expect(await screen.findByText('Letzter Schritt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('reverts the invoice when "Löschen" is confirmed', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'bezahlt' }, onChanged },
    });

    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Ja, löschen' }));

    await waitFor(() => expect(api.invoices.revert).toHaveBeenCalledWith('inv-1', {}));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows "Bearbeiten" for status eingereicht and navigates to the submit page', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'eingereicht' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/invoices/inv-1/submit'));
  });

  it('opens the refund form pre-filled for editing when "Bearbeiten" is clicked for status erstattet', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: {
        invoice: {
          ...BASE_INVOICE,
          status: 'erstattet',
          positions: [{ ...BASE_INVOICE.positions[0]!, refund_amount: 7.25 }],
        },
        onChanged: vi.fn(),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    expect(await screen.findByText('Erstattungsbeträge korrigieren')).toBeInTheDocument();
    const input = await screen.findByLabelText(/Erstattungsbetrag für Position 1/);
    expect((input as HTMLInputElement).value).toBe('7.25');
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeInTheDocument();
  });

  it('shows an error alert when revert fails', async () => {
    vi.mocked(api.invoices.revert).mockRejectedValueOnce(new Error('Revert-Fehler'));
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: { ...BASE_INVOICE, status: 'bezahlt' }, onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Ja, löschen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Revert-Fehler');
  });
});
