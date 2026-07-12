// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceStatus, InvoiceWithPositions, InvoiceStatusEvent } from '@selbstbehalt/shared';

vi.mock('$lib/api', () => ({
  api: {
    invoices: {
      events: vi.fn().mockResolvedValue([]),
      changeReview: vi.fn().mockResolvedValue({}),
      changePayment: vi.fn().mockResolvedValue({}),
      refund: vi.fn().mockResolvedValue({}),
      revertSubmission: vi.fn().mockResolvedValue({}),
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

const GROUND: InvoiceStatus = {
  review: 'neu',
  payment: 'offen',
  submission: 'nicht_eingereicht',
  paid_on: null,
};

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
  status: GROUND,
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

/** Build a test invoice with a partial derived-status override. */
function inv(
  status: Partial<InvoiceStatus> = {},
  over: Partial<InvoiceWithPositions> = {},
): InvoiceWithPositions {
  return { ...BASE_INVOICE, status: { ...GROUND, ...status }, ...over };
}

describe('InvoiceStatusFlow — Prüfung track', () => {
  it('renders the three track badges', async () => {
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });
    expect(await screen.findByText('Neu')).toBeInTheDocument();
    expect(screen.getByText('Offen')).toBeInTheDocument();
    expect(screen.getByText('Nicht eingereicht')).toBeInTheDocument();
  });

  it('marks the invoice geprüft', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged } });

    await user.click(await screen.findByRole('button', { name: 'Als geprüft markieren' }));

    await waitFor(() =>
      expect(api.invoices.changeReview).toHaveBeenCalledWith('inv-1', { status: 'geprüft' }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('takes the review back to neu when nothing else has progressed', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Prüfung zurücknehmen' }));

    await waitFor(() =>
      expect(api.invoices.changeReview).toHaveBeenCalledWith('inv-1', { status: 'neu' }),
    );
  });

  it('disables "Prüfung zurücknehmen" once the invoice is paid', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', payment: 'bezahlt' }), onChanged: vi.fn() },
    });
    expect(await screen.findByRole('button', { name: 'Prüfung zurücknehmen' })).toBeDisabled();
  });
});

describe('InvoiceStatusFlow — Bezahlung track', () => {
  it('is gated behind the review step', async () => {
    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });
    await screen.findByText('Neu');
    expect(screen.queryByRole('button', { name: 'Als bezahlt markieren' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Erst nach der Prüfung möglich.').length).toBeGreaterThan(0);
  });

  it('records a payment with its date once geprüft', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Als bezahlt markieren' }));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(api.invoices.changePayment).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({ status: 'bezahlt' }),
      ),
    );
  });

  it('reverts a payment', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: {
        invoice: inv({ review: 'geprüft', payment: 'bezahlt', paid_on: '2026-07-01' }),
        onChanged: vi.fn(),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Zahlung zurücknehmen' }));

    await waitFor(() =>
      expect(api.invoices.changePayment).toHaveBeenCalledWith('inv-1', { status: 'offen' }),
    );
  });
});

describe('InvoiceStatusFlow — Einreichung / Erstattung track', () => {
  it('navigates to the submit page from "Einreichen …"', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Einreichen …' }));

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/invoices/inv-1/submit'));
  });

  it('can submit before the invoice is paid (parallel tracks)', async () => {
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft' }), onChanged: vi.fn() },
    });
    // Payment still offen, yet "Einreichen …" is available.
    expect(await screen.findByRole('button', { name: 'Einreichen …' })).toBeInTheDocument();
    expect(screen.getByText('Offen')).toBeInTheDocument();
  });

  it('opens the refund form (category mode) from "Erstattung erfassen"', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    expect(await screen.findByText('Erstattungsbeträge erfassen')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Je Kategorie' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Je Position' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erstattung speichern' })).toBeInTheDocument();
  });

  it('pre-fills the category amount with the category eligible sum in category mode', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    const input = await screen.findByLabelText(/Erstattungsbetrag für Kategorie Ambulant/);
    expect((input as HTMLInputElement).value).toBe('8.5');
  });

  it('distributes the category amount onto positions when submitting in category mode', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const invoice = inv(
      { review: 'geprüft', submission: 'eingereicht' },
      {
        positions: [
          { ...BASE_INVOICE.positions[0]!, id: 'pos-1', eligible_amount: 30, charged_amount: 40 },
          {
            ...BASE_INVOICE.positions[0]!,
            id: 'pos-2',
            goae_number: '5',
            eligible_amount: 10,
            charged_amount: 20,
          },
        ],
      },
    );
    render(InvoiceStatusFlow, { props: { invoice, onChanged } });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    const input = await screen.findByLabelText(/Erstattungsbetrag für Kategorie Ambulant/);
    await user.clear(input);
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Erstattung speichern' }));

    await waitFor(() =>
      expect(api.invoices.refund).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({
          positions: [
            { id: 'pos-1', refund_amount: 15 },
            { id: 'pos-2', refund_amount: 5 },
          ],
        }),
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('switches to per-position entry and submits per-position amounts', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    await user.click(screen.getByRole('tab', { name: 'Je Position' }));

    const input = await screen.findByLabelText(/Erstattungsbetrag für Position 1/);
    expect((input as HTMLInputElement).value).toBe('8.5');

    await user.click(screen.getByRole('button', { name: 'Erstattung speichern' }));
    await waitFor(() =>
      expect(api.invoices.refund).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({ positions: [{ id: 'pos-1', refund_amount: 8.5 }] }),
      ),
    );
  });

  it('closes the refund form when Abbrechen is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    expect(screen.getByText('Erstattungsbeträge erfassen')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByText('Erstattungsbeträge erfassen')).not.toBeInTheDocument();
  });

  it('shows edit/delete but no "Erstattung erfassen" for an already-reimbursed invoice', async () => {
    render(InvoiceStatusFlow, {
      props: {
        invoice: inv(
          { review: 'geprüft', submission: 'erstattet' },
          { positions: [{ ...BASE_INVOICE.positions[0]!, refund_amount: 7.25 }] },
        ),
        onChanged: vi.fn(),
      },
    });
    await waitFor(() => expect(screen.getByText('Erstattet')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Erstattung bearbeiten' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erstattung erfassen' })).not.toBeInTheDocument();
  });

  it('deletes the submission when confirmed', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged },
    });

    await user.click(await screen.findByRole('button', { name: 'Einreichung löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Ja, löschen' }));

    await waitFor(() => expect(api.invoices.revertSubmission).toHaveBeenCalledWith('inv-1', {}));
    expect(onChanged).toHaveBeenCalled();
  });

  it('opens the refund form pre-filled for editing from "Erstattung bearbeiten"', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: {
        invoice: inv(
          { review: 'geprüft', submission: 'erstattet' },
          { positions: [{ ...BASE_INVOICE.positions[0]!, refund_amount: 7.25 }] },
        ),
        onChanged: vi.fn(),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung bearbeiten' }));

    expect(await screen.findByText('Erstattungsbeträge korrigieren')).toBeInTheDocument();
    const input = await screen.findByLabelText(/Erstattungsbetrag für Kategorie Ambulant/);
    expect((input as HTMLInputElement).value).toBe('7.25');
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeInTheDocument();
  });
});

describe('InvoiceStatusFlow — history & errors', () => {
  it('loads and displays status event history with track labels', async () => {
    const events: InvoiceStatusEvent[] = [
      {
        id: 'ev-1',
        invoice_id: 'inv-1',
        track: 'review',
        status: 'neu',
        changed_at: '2025-03-15T10:00:00Z',
        note: null,
      },
      {
        id: 'ev-2',
        invoice_id: 'inv-1',
        track: 'review',
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

  it('shows an error alert when a review change fails', async () => {
    vi.mocked(api.invoices.changeReview).mockRejectedValueOnce(new Error('Netzwerkfehler'));
    const user = userEvent.setup();

    render(InvoiceStatusFlow, { props: { invoice: BASE_INVOICE, onChanged: vi.fn() } });

    await user.click(await screen.findByRole('button', { name: 'Als geprüft markieren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Netzwerkfehler');
  });

  it('shows an error alert when the refund API call fails', async () => {
    vi.mocked(api.invoices.refund).mockRejectedValueOnce(new Error('Erstattungsfehler'));
    const user = userEvent.setup();

    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));
    await user.click(screen.getByRole('button', { name: 'Erstattung speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Erstattungsfehler');
  });

  it('shows "Keine Positionen vorhanden" in refund form when invoice has no positions', async () => {
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: {
        invoice: inv({ review: 'geprüft', submission: 'eingereicht' }, { positions: [] }),
        onChanged: vi.fn(),
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Erstattung erfassen' }));

    expect(await screen.findByText('Keine Positionen vorhanden.')).toBeInTheDocument();
  });

  it('shows an error alert when the submission revert fails', async () => {
    vi.mocked(api.invoices.revertSubmission).mockRejectedValueOnce(new Error('Revert-Fehler'));
    const user = userEvent.setup();
    render(InvoiceStatusFlow, {
      props: { invoice: inv({ review: 'geprüft', submission: 'eingereicht' }), onChanged: vi.fn() },
    });

    await user.click(await screen.findByRole('button', { name: 'Einreichung löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Ja, löschen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Revert-Fehler');
  });
});
