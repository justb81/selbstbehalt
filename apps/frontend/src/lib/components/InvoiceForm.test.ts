// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// InvoiceForm is a thin wrapper around @selbstbehalt/medic-invoice-check's
// <InvoiceReview>; stub the review so these tests exercise only the wrapper's
// own behaviour (person selection, Notizen, save-payload assembly, errors,
// labels). The review's OCR/positions/validation behaviour is covered by
// InvoiceReview.test.ts in the package.
vi.mock('@selbstbehalt/medic-invoice-check', async () => ({
  InvoiceReview: (await import('./__mocks__/InvoiceReviewStub.svelte')).default,
}));

import InvoiceForm from './InvoiceForm.svelte';
import type { FormPayload } from './InvoiceForm.svelte';
import type { InvoiceWithPositions } from '@selbstbehalt/shared';

const INSURED_OPTIONS = [
  { id: 'ip-1', label: 'TestAG · Komfort', insuredPerson: {} as never },
  { id: 'ip-2', label: 'TestAG · Basis', insuredPerson: {} as never },
];

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
  status: { review: 'neu', payment: 'offen', submission: 'nicht_eingereicht', paid_on: null },
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

/** An invoice whose single position is §10 GOÄ Auslagenersatz (Betrag = Anzahl × Basis). */
const AUSLAGEN_INVOICE: InvoiceWithPositions = {
  ...SAMPLE_INVOICE,
  positions: [
    {
      ...SAMPLE_INVOICE.positions[0]!,
      id: 'pos-a',
      goae_category: 'Auslagenersatz',
      goae_number: 'PORTO',
      quantity: 1,
      multiplier: 2,
      base_amount: 5,
      charged_amount: 5,
    },
  ],
};

/** An invoice whose single position is a per-Rezept Arznei-/Hilfsmittel line (Anzahl × Basis). */
const ARZNEI_INVOICE: InvoiceWithPositions = {
  ...SAMPLE_INVOICE,
  positions: [
    {
      ...SAMPLE_INVOICE.positions[0]!,
      id: 'pos-h',
      goae_category: 'Arznei-/Hilfsmittel',
      goae_number: '',
      description: 'Einlagen',
      quantity: 2,
      multiplier: 2.3,
      base_amount: 15,
      charged_amount: 30,
    },
  ],
};

describe('InvoiceForm — create mode (wrapper)', () => {
  it('shows the "Rechnung speichern" submit label', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Rechnung speichern' })).toBeInTheDocument();
  });

  it('renders the versicherte-Person selector', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    expect(screen.getByText('Versicherte Person')).toBeInTheDocument();
  });

  it('calls onSave with the assembled payload when the form is valid', async () => {
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
    expect(payload.notes).toBeNull();
  });

  it('includes typed Notizen in the payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave },
    });

    await user.type(screen.getByRole('textbox', { name: /Leistungserbringer/i }), 'Praxis Test');
    const totalInput = screen.getByRole('spinbutton', { name: /Rechnungsbetrag/i });
    await user.clear(totalInput);
    await user.type(totalInput, '50');
    await user.type(screen.getByLabelText('Notizen'), 'Bitte prüfen');

    await user.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(onSave.mock.calls[0]![0].notes).toBe('Bitte prüfen');
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

  it('renders the cancel snippet when provided', () => {
    render(InvoiceForm, {
      props: { mode: 'create', insuredOptions: INSURED_OPTIONS, onSave: vi.fn() },
    });
    // No cancel snippet passed — the submit button is still present.
    expect(screen.getByText('Rechnung speichern')).toBeInTheDocument();
  });
});

describe('InvoiceForm — edit mode (wrapper)', () => {
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

  it('pre-fills the Notizen field from initialData', () => {
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: SAMPLE_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave: vi.fn(),
      },
    });
    expect(screen.getByDisplayValue('Test-Notiz')).toBeInTheDocument();
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

  it('clears the Ziffer and fixes Faktor at 1 on save for an Auslagenersatz position, keeping Basis', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: AUSLAGEN_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));

    const payload = onSave.mock.calls[0]![0];
    expect(payload.positions[0]!.goae_number).toBe('');
    expect(payload.positions[0]!.multiplier).toBe(1);
    // Basis (Einzelpreis) is kept — the amount is Anzahl × Basis, not zeroed.
    expect(payload.positions[0]!.base_amount).toBe(5);
    expect(payload.positions[0]!.charged_amount).toBe(5);
  });

  it('saves an Arznei-/Hilfsmittel position as Anzahl × Basis with no Ziffer/Faktor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(p: FormPayload) => void>();
    render(InvoiceForm, {
      props: {
        mode: 'edit',
        initialData: ARZNEI_INVOICE,
        insuredOptions: INSURED_OPTIONS,
        onSave,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));

    const payload = onSave.mock.calls[0]![0];
    expect(payload.positions[0]!.goae_category).toBe('Arznei-/Hilfsmittel');
    expect(payload.positions[0]!.goae_number).toBe('');
    expect(payload.positions[0]!.multiplier).toBe(1);
    expect(payload.positions[0]!.quantity).toBe(2);
    expect(payload.positions[0]!.base_amount).toBe(15);
    expect(payload.positions[0]!.charged_amount).toBe(30);
  });
});
