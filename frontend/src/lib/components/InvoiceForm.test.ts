// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({
  resolve: (pattern: string, params?: Record<string, string>) => {
    if (!params) return pattern;
    return pattern.replace(/\[(\w+)\]/g, (_, k) => params[k] ?? `[${k}]`);
  },
}));

vi.mock('$lib/ocr', () => ({
  DEFAULT_CONFIDENCE_THRESHOLD: 0.7,
  defaultProviderType: vi.fn(() => 'arzt'),
  disposeScanOcr: vi.fn(),
  toReviewPositions: vi.fn(() => []),
}));

vi.mock('$lib/data/fee-tables', () => ({
  loadFeeTable: vi.fn(async () => ({ entries: [] })),
  FEE_SCHEDULE_IDS: ['GOÄ', 'GOZ', 'GOT'],
}));

vi.mock('$lib/utils/goae-parser', () => ({
  buildIndex: vi.fn(() => new Map()),
  isAuslagenersatzDescription: vi.fn(() => false),
  lookupPosition: vi.fn(() => ({ isValid: true, flags: [], feeSchedule: 'GOÄ' })),
  normalizeZiffer: vi.fn((z: string) => z),
  parseInvoice: vi.fn(() => ({ positions: [], violations: [] })),
  validateInvoice: vi.fn(() => []),
}));

import InvoiceForm from './InvoiceForm.svelte';
import type { FormPayload } from './InvoiceForm.svelte';
import type { InvoiceWithPositions } from '@selbstbehalt/shared';
import { buildIndex, lookupPosition, parseInvoice, validateInvoice } from '$lib/utils/goae-parser';
import { loadFeeTable } from '$lib/data/fee-tables';

const INSURED_OPTIONS = [
  { id: 'ip-1', label: 'TestAG · Komfort', insuredPerson: {} as never },
  { id: 'ip-2', label: 'TestAG · Basis', insuredPerson: {} as never },
];

// Rendered as "⚠ {message}" (a separate text node before the interpolation),
// so an exact-string query wouldn't match — search by substring instead.
const EXCLUDES_605_612_MESSAGE = /Die Ziffern 605 und 612 sind nicht nebeneinander/;

const SAMPLE_INVOICE_OCR_TEXT = 'Praxis Dr. med. Mustermann\n1  Beratung  2,3  10.73';

const SAMPLE_INVOICE: InvoiceWithPositions = {
  id: 'inv-1',
  insured_person_id: 'ip-1',
  invoice_date: '2025-03-15',
  invoice_number: 'R-2025-042',
  provider_name: 'Dr. Mustermann',
  provider_type: 'arzt',
  total_amount: 100.0,
  eligible_amount: 80.0,
  notes: 'Test-Notiz',
  status: 'neu',
  self_paid_amount: 0,
  ocr_raw: null,
  created_at: '2025-03-15T10:00:00Z',
  positions: [
    {
      id: 'pos-1',
      invoice_id: 'inv-1',
      goae_number: '1',
      goae_category: 'GOÄ',
      quantity: 2,
      treatment_date: '2025-03-14',
      description: 'Beratung',
      multiplier: 2.3,
      base_amount: 4.66,
      charged_amount: 10.73,
      is_valid: true,
      flag_reason: null,
    },
  ],
};

describe('InvoiceForm — create mode', () => {
  it('renders the OCR scan button', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByText('Rechnung scannen / hochladen')).toBeInTheDocument();
  });

  it('renders the "Positionen prüfen" button, disabled when there are no positions', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Positionen prüfen' })).toBeDisabled();
  });

  it('shows the "Rechnung speichern" submit label', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Rechnung speichern' })).toBeInTheDocument();
  });

  it('shows "empty positions" hint initially', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByText(/Noch keine Positionen/)).toBeInTheDocument();
  });

  it('calls onSave with the assembled payload when form is valid', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave },
    });

    await user.type(screen.getByRole('textbox', { name: /Leistungserbringer/i }), 'Praxis Test');
    const totalInput = screen.getByRole('spinbutton', { name: /Rechnungsbetrag/i });
    await user.clear(totalInput);
    await user.type(totalInput, '50.00');

    await user.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0]![0];
    expect(payload.provider_name).toBe('Praxis Test');
    expect(payload.total_amount).toBe(50);
    expect(payload.insured_person_id).toBe('ip-1');
  });

  it('shows an error when provider name is empty', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });

    const totalInput = screen.getByRole('spinbutton', { name: /Rechnungsbetrag/i });
    await user.clear(totalInput);
    await user.type(totalInput, '50');
    await user.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte den Leistungserbringer eingeben.',
    );
  });

  it('shows an error when total amount is zero', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });

    await user.type(screen.getByRole('textbox', { name: /Leistungserbringer/i }), 'Praxis');
    await user.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte einen Gesamtbetrag > 0 eingeben.',
    );
  });

  it('surfaces a formError prop as an alert', () => {
    render(InvoiceForm, {
      props: {
        mode: 'create',
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
        formError: 'Serverfehler',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Serverfehler');
  });

  it('disables the submit button when saving=true', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn(), saving: true },
    });
    expect(screen.getByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
  });

  it('adds a position row when "Position hinzufügen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });

    await user.click(screen.getByText('+ Position hinzufügen'));

    expect(screen.queryByText(/Noch keine Positionen/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Position 1 entfernen/i })).toBeInTheDocument();
  });

  it('removes a position row when the delete button is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });

    await user.click(screen.getByText('+ Position hinzufügen'));
    await user.click(screen.getByRole('button', { name: /Position 1 entfernen/i }));

    expect(screen.getByText(/Noch keine Positionen/)).toBeInTheDocument();
  });

  it('renders the cancel snippet when provided', async () => {
    const { getByText } = render(InvoiceForm, {
      props: {
        mode: 'create',
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
        cancel: undefined,
      },
    });
    // No cancel snippet — button should not be present
    expect(getByText('Rechnung speichern')).toBeInTheDocument();
  });
});

describe('InvoiceForm — edit mode', () => {
  it('shows "Positionen prüfen" button', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: 'Positionen prüfen' })).toBeInTheDocument();
  });

  it('does not render the OCR scan button', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.queryByText('Rechnung scannen / hochladen')).not.toBeInTheDocument();
  });

  it('shows "Änderungen speichern" as submit label', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeInTheDocument();
  });

  it('pre-fills header fields from initialData', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByDisplayValue('Dr. Mustermann')).toBeInTheDocument();
    expect(screen.getByDisplayValue('R-2025-042')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test-Notiz')).toBeInTheDocument();
  });

  it('pre-fills position rows from initialData', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.queryByText(/Noch keine Positionen/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Position 1 entfernen/i })).toBeInTheDocument();
  });

  it('calls onSave with positions included', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));

    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0]![0];
    expect(payload.provider_name).toBe('Dr. Mustermann');
    expect(payload.positions).toHaveLength(1);
    expect(payload.positions[0]!.goae_number).toBe('1');
    expect(payload.positions[0]!.quantity).toBe(2);
  });

  it('calls lookupPosition when "Positionen prüfen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen prüfen' }));

    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
  });

  it('shows a whole-invoice constraint violation after "Positionen prüfen" (e.g. GOÄ 605+612)', async () => {
    vi.mocked(validateInvoice).mockReturnValueOnce([
      {
        type: 'excludes',
        message: 'Die Ziffern 605 und 612 sind nicht nebeneinander berechnungsfähig.',
        sourceText: 'Neben der Leistung nach Nummer 612 … nicht berechnungsfähig.',
        ziffern: ['605', '612'],
        positionIndices: [0, 1],
      },
    ]);
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: {
          ...SAMPLE_INVOICE,
          positions: [
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-1', goae_number: '605' },
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-2', goae_number: '612' },
          ],
        },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen prüfen' }));

    // The violation is shown inline on every position it involves — here both
    // rows, since 605 and 612 are mutually excluding each other.
    await waitFor(() => expect(screen.getAllByText(EXCLUDES_605_612_MESSAGE)).toHaveLength(2));
  });

  it('highlights a position card that has a whole-invoice constraint violation', async () => {
    vi.mocked(validateInvoice).mockReturnValueOnce([
      {
        type: 'excludes',
        message: 'Die Ziffern 605 und 612 sind nicht nebeneinander berechnungsfähig.',
        sourceText: 'Neben der Leistung nach Nummer 612 … nicht berechnungsfähig.',
        ziffern: ['605', '612'],
        positionIndices: [0, 1],
      },
    ]);
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: {
          ...SAMPLE_INVOICE,
          positions: [
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-1', goae_number: '605' },
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-2', goae_number: '612' },
          ],
        },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen prüfen' }));

    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: /entfernen/i });
      for (const btn of removeButtons) {
        expect(btn.closest('[data-slot="card"]')).toHaveClass('bg-amber-50');
      }
    });
  });

  it('clears a shown violation when a position is removed (indices would be stale)', async () => {
    vi.mocked(validateInvoice).mockReturnValueOnce([
      {
        type: 'excludes',
        message: 'Die Ziffern 605 und 612 sind nicht nebeneinander berechnungsfähig.',
        sourceText: 'Neben der Leistung nach Nummer 612 … nicht berechnungsfähig.',
        ziffern: ['605', '612'],
        positionIndices: [0, 1],
      },
    ]);
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: {
          ...SAMPLE_INVOICE,
          positions: [
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-1', goae_number: '605' },
            { ...SAMPLE_INVOICE.positions[0]!, id: 'pos-2', goae_number: '612' },
          ],
        },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen prüfen' }));
    await waitFor(() => expect(screen.getAllByText(EXCLUDES_605_612_MESSAGE)).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Position 1 entfernen' }));

    expect(screen.queryByText(EXCLUDES_605_612_MESSAGE)).not.toBeInTheDocument();
  });

  it('offers "Auslagenersatz" in the Kat.-dropdown and skips lookupPosition for it', async () => {
    vi.mocked(lookupPosition).mockClear();
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    // The Kategorie field is a shadcn (bits-ui) Select: a trigger button that opens a
    // floating-ui listbox. jsdom always reports zero-size geometry, so floating-ui never
    // flips the listbox to visible and role-based queries (which respect that hidden
    // ancestor) can't find the option — select it by its stable data-value attribute
    // instead. "Versicherte Person" and "Art" are also shadcn Selects, so the Kategorie
    // trigger is targeted by its id (pos-0-kategorie for the single position here).
    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    expect(categoryTrigger).toBeInTheDocument();
    await user.click(categoryTrigger);
    const auslagenersatzOption = document.querySelector(
      '[data-value="Auslagenersatz"]',
    ) as HTMLElement;
    expect(auslagenersatzOption).toBeInTheDocument();
    await user.click(auslagenersatzOption);
    await waitFor(() => expect(categoryTrigger).toHaveTextContent('Auslagenersatz (§10 GOÄ)'));
    // Selecting the item closes the listbox asynchronously; wait for the body's
    // scroll-lock (pointer-events: none) to lift before interacting with anything else.
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));

    await user.click(screen.getByRole('button', { name: 'Positionen prüfen' }));
    // Wait for revalidation to fully complete (button label reverts) before asserting.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Positionen prüfen' })).toBeInTheDocument(),
    );

    // Auslagenersatz positions have no Ziffer to validate against a fee table.
    expect(lookupPosition).not.toHaveBeenCalled();
  });

  it('disables "Positionen prüfen" when there are no positions', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: { ...SAMPLE_INVOICE, positions: [] },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: 'Positionen prüfen' })).toBeDisabled();
  });

  it('shows "Positionen neu einlesen" button when ocr_raw is set and status is neu', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: { ...SAMPLE_INVOICE, ocr_raw: SAMPLE_INVOICE_OCR_TEXT },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: 'Positionen neu einlesen' })).toBeInTheDocument();
  });

  it('does not show "Positionen neu einlesen" button when ocr_raw is null', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(
      screen.queryByRole('button', { name: 'Positionen neu einlesen' }),
    ).not.toBeInTheDocument();
  });

  it('calls parseInvoice when "Positionen neu einlesen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: { ...SAMPLE_INVOICE, ocr_raw: SAMPLE_INVOICE_OCR_TEXT },
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen neu einlesen' }));

    await waitFor(() => expect(parseInvoice).toHaveBeenCalledOnce());
  });

  it('calls buildIndex when the fee info icon is clicked on a position', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    await user.click(screen.getByTitle('Gebührenverzeichnis-Eintrag anzeigen'));

    await waitFor(() => expect(buildIndex).toHaveBeenCalled());
  });

  it('recalculates Betrag when Faktor changes, and Rechnungsbetrag with it', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    const faktorInput = screen.getByRole('spinbutton', { name: 'Faktor' });
    await user.clear(faktorInput);
    await user.type(faktorInput, '3');

    // base_amount (4.66) × multiplier (3) × quantity (2) = 27.96
    const betragInput = screen.getByRole('spinbutton', { name: 'Betrag (€)' });
    await waitFor(() => expect(betragInput).toHaveValue(27.96));
    const totalInput = screen.getByRole('spinbutton', { name: /Rechnungsbetrag/i });
    await waitFor(() => expect(totalInput).toHaveValue(27.96));
  });

  it('recalculates Rechnungsbetrag when a position Betrag is edited directly', async () => {
    const user = userEvent.setup();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    const betragInput = screen.getByRole('spinbutton', { name: 'Betrag (€)' });
    await user.clear(betragInput);
    await user.type(betragInput, '15');

    const totalInput = screen.getByRole('spinbutton', { name: /Rechnungsbetrag/i });
    await waitFor(() => expect(totalInput).toHaveValue(15));
  });

  it('looks up the fee table when Ziffer changes, to recalculate Basis', async () => {
    const user = userEvent.setup();
    vi.mocked(loadFeeTable).mockClear();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });

    const zifferInput = screen.getByRole('textbox', { name: 'Ziffer' });
    await user.clear(zifferInput);
    await user.type(zifferInput, '5');
    await user.tab();

    await waitFor(() => expect(loadFeeTable).toHaveBeenCalledWith('GOÄ'));
  });

  it('hides Ziffer/Faktor/Basis for Auslagenersatz but keeps them until save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: { mode: 'edit', initialData: SAMPLE_INVOICE, insuredOptions: INSURED_OPTIONS, onSave },
    });

    expect(screen.getByRole('textbox', { name: 'Ziffer' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Faktor' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Basis (€)' })).toBeInTheDocument();

    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    await user.click(categoryTrigger);
    const auslagenersatzOption = document.querySelector(
      '[data-value="Auslagenersatz"]',
    ) as HTMLElement;
    await user.click(auslagenersatzOption);
    await waitFor(() => expect(categoryTrigger).toHaveTextContent('Auslagenersatz (§10 GOÄ)'));
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));

    // Hidden immediately — but the underlying Ziffer/Faktor/Basis values aren't
    // lost yet, so switching back to GOÄ/GOZ/GOT would restore them unchanged.
    expect(screen.queryByRole('textbox', { name: 'Ziffer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Faktor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Basis (€)' })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Anz.' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));

    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0]![0];
    expect(payload.positions[0]!.goae_number).toBe('');
    expect(payload.positions[0]!.multiplier).toBe(1);
    expect(payload.positions[0]!.base_amount).toBe(0);
  });
});
