// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ocr', () => ({
  DEFAULT_CONFIDENCE_THRESHOLD: 0.7,
  disposeScanOcr: vi.fn(),
  toReviewPositions: vi.fn(() => []),
}));

// OCRScanner imports the recognition pipeline from this module directly (not
// via the '../ocr' barrel above), so a scan can be driven end-to-end in tests.
vi.mock('../ocr/scan-ocr', () => ({
  loadAllInvoiceImages: vi.fn(async () => [
    { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' },
  ]),
  recognizeInvoiceImage: vi.fn(async () => []),
}));

vi.mock('../data/fee-tables', () => ({
  loadFeeTable: vi.fn(async () => ({ entries: [] })),
  FEE_SCHEDULE_IDS: ['GOÄ', 'GOZ', 'GOT'],
  SUPPORTED_INVOICE_SCHEDULES: ['GOÄ', 'GOZ'],
}));

vi.mock('../utils/goae-parser', () => ({
  buildIndex: vi.fn(() => new Map()),
  detectProviderType: vi.fn(() => 'arzt'),
  isAuslagenersatzDescription: vi.fn(() => false),
  lookupPosition: vi.fn(() => ({ isValid: true, flags: [], feeSchedule: 'GOÄ' })),
  normalizeZiffer: vi.fn((z: string) => z),
  parseInvoice: vi.fn(() => ({ positions: [], violations: [] })),
  // Default: pass positions through unchanged, as if no whole-invoice violation
  // applied — matches the real function's no-violation fast path.
  validatePositions: vi.fn((positions: unknown[]) => ({ positions, violations: [] })),
}));

import InvoiceReviewTestHarness from './InvoiceReviewTestHarness.svelte';
import type { ReviewPositionRow } from './invoice-review-types';
import {
  buildIndex,
  detectProviderType,
  lookupPosition,
  parseInvoice,
  validatePositions,
} from '../utils/goae-parser';
import { loadFeeTable } from '../data/fee-tables';
import { toReviewPositions } from '../ocr';
import type { ReviewPosition } from '../ocr';

beforeEach(() => {
  vi.clearAllMocks();
});

const SAMPLE_POSITION: ReviewPositionRow = {
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
  confidence: 1,
  benefit_category: null,
};

/** Two positions (GOÄ 605 + 612) that mutually exclude each other. */
const EXCLUDES_POSITIONS: ReviewPositionRow[] = [
  { ...SAMPLE_POSITION, goae_number: '605' },
  { ...SAMPLE_POSITION, goae_number: '612' },
];

// Rendered as "⚠ {message}" (a separate text node before the interpolation),
// so an exact-string query wouldn't match — search by substring instead.
const EXCLUDES_605_612_MESSAGE = /Die Ziffern 605 und 612 sind nicht nebeneinander/;
const EXCLUDES_605_612_REASON =
  'Die Ziffern 605 und 612 sind nicht nebeneinander berechnungsfähig.';

/** Mocks validatePositions to flag both given rows as mutually excluding, as
 *  GOÄ 605/612 do — persisted via each row's is_valid/flag_reason. */
function mockExcludesViolation() {
  vi.mocked(validatePositions).mockReturnValueOnce({
    positions: [
      {
        isValid: false,
        flags: [{ code: 'constraint_violation', reason: EXCLUDES_605_612_REASON }],
        feeSchedule: 'GOÄ',
      },
      {
        isValid: false,
        flags: [{ code: 'constraint_violation', reason: EXCLUDES_605_612_REASON }],
        feeSchedule: 'GOÄ',
      },
    ],
    violations: [],
  } as never);
}

/** Real timers only — waits past the 400ms auto-revalidation debounce so a
 *  negative assertion (e.g. "lookupPosition was NOT called") is meaningful. */
async function waitPastDebounce() {
  await new Promise((r) => setTimeout(r, 500));
}

const SAMPLE_OCR_TEXT = 'Praxis Dr. med. Mustermann\n1  Beratung  2,3  10.73';

describe('InvoiceReview — create mode', () => {
  it('always renders the OCR scanner (no toggle button)', () => {
    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });
    expect(screen.getByLabelText('Rechnungsdatei (Bild oder PDF)')).toBeInTheDocument();
    expect(screen.queryByText('Rechnung scannen / hochladen')).not.toBeInTheDocument();
  });

  it('accepts a shared file without a toggle (issue #158)', async () => {
    const sharedFile = new File(['x'], 'geteilte-rechnung.pdf', { type: 'application/pdf' });
    render(InvoiceReviewTestHarness, { props: { mode: 'create', sharedFile } });
    await waitFor(() =>
      expect(screen.getByLabelText('Rechnungsdatei (Bild oder PDF)')).toBeInTheDocument(),
    );
  });

  it('shows the "empty positions" hint initially', () => {
    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });
    expect(screen.getByText(/Noch keine Positionen/)).toBeInTheDocument();
  });

  it("keeps each position's own detected schedule after a scan, instead of overwriting it with the invoice's primary schedule (issue #249)", async () => {
    // A Kieferorthopäde invoice (primary schedule GOZ) with one GOZ position and
    // one Ä-prefixed GOÄ position, exactly as `toReviewPositions` would report them.
    vi.mocked(detectProviderType).mockReturnValueOnce('kieferorthopaede');
    vi.mocked(toReviewPositions).mockReturnValueOnce([
      {
        goaeNumber: '6070',
        goaeCategory: 'GOZ',
        quantity: 1,
        treatmentDate: '2026-04-13',
        description: 'Einstellung der Kiefer, mittlerer Umfang',
        multiplier: 3.5,
        baseAmount: 14.62,
        chargedAmount: 51.18,
        isValid: true,
        flagReason: null,
        confidence: 1,
      },
      {
        goaeNumber: 'Ä1',
        goaeCategory: 'GOÄ',
        quantity: 1,
        treatmentDate: '2026-04-13',
        description: 'Beratung, auch telefonisch',
        multiplier: 2.3,
        baseAmount: 4.66,
        chargedAmount: 10.72,
        isValid: true,
        flagReason: null,
        confidence: 1,
      },
    ] satisfies ReviewPosition[]);

    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });
    const file = new File(['x'], 'rechnung.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Rechnungsdatei (Bild oder PDF)'), file);

    await waitFor(() =>
      expect(document.getElementById('pos-0-kategorie')).toHaveTextContent('GOZ'),
    );
    expect(document.getElementById('pos-1-kategorie')).toHaveTextContent('GOÄ');
  });

  it('adds a position row when "Position hinzufügen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });

    await user.click(screen.getByRole('button', { name: 'Position hinzufügen' }));

    expect(screen.queryByText(/Noch keine Positionen/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Position 1 entfernen/i })).toBeInTheDocument();
  });

  it('removes a position row when the delete button is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });

    await user.click(screen.getByRole('button', { name: 'Position hinzufügen' }));
    await user.click(screen.getByRole('button', { name: /Position 1 entfernen/i }));

    expect(screen.getByText(/Noch keine Positionen/)).toBeInTheDocument();
  });

  it('does not render the reparse button', () => {
    render(InvoiceReviewTestHarness, { props: { mode: 'create' } });
    expect(
      screen.queryByRole('button', { name: 'Positionen neu einlesen' }),
    ).not.toBeInTheDocument();
  });
});

describe('InvoiceReview — edit mode', () => {
  it('does not render the OCR scanner', () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    expect(screen.queryByLabelText('Rechnungsdatei (Bild oder PDF)')).not.toBeInTheDocument();
  });

  it('pre-fills the header fields from the bound props', () => {
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        initialProviderName: 'Dr. Mustermann',
        initialInvoiceNumber: 'R-2025-042',
      },
    });
    expect(screen.getByDisplayValue('Dr. Mustermann')).toBeInTheDocument();
    expect(screen.getByDisplayValue('R-2025-042')).toBeInTheDocument();
  });

  it('pre-fills position rows from the bound props', () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    expect(screen.queryByText(/Noch keine Positionen/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Position 1 entfernen/i })).toBeInTheDocument();
  });

  it('does not collapse positions on initial mount, even when already valid (issue #207)', () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    expect(screen.getByRole('textbox', { name: 'Ziffer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Position 1 minimieren' })).toBeInTheDocument();
  });

  it('minimizes and re-expands a position via its toggle button (issue #207)', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });

    await user.click(screen.getByRole('button', { name: 'Position 1 minimieren' }));
    expect(screen.queryByRole('textbox', { name: 'Ziffer' })).not.toBeInTheDocument();
    // Header stays visible while collapsed.
    expect(screen.getByText('Position 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Position 1 entfernen/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Position 1 einblenden' }));
    expect(screen.getByRole('textbox', { name: 'Ziffer' })).toBeInTheDocument();
  });

  it('collapses positions found valid after "Positionen neu einlesen", keeps flagged ones expanded (issue #207)', async () => {
    const user = userEvent.setup();
    vi.mocked(parseInvoice).mockReturnValueOnce({
      positions: [
        {
          ziffer: '1',
          feeSchedule: 'GOÄ',
          quantity: 1,
          treatmentDate: '2025-03-14',
          description: 'Beratung',
          multiplier: 2.3,
          baseAmount: 4.66,
          chargedAmount: 10.73,
          isValid: true,
          flags: [],
        },
        {
          ziffer: '605',
          feeSchedule: 'GOÄ',
          quantity: 1,
          treatmentDate: '2025-03-14',
          description: 'Sonographie',
          multiplier: 1.8,
          baseAmount: 20,
          chargedAmount: 36,
          isValid: false,
          flags: [{ code: 'constraint_violation', reason: EXCLUDES_605_612_REASON }],
        },
      ],
      violations: [],
    } as never);

    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        initialPositions: [{ ...SAMPLE_POSITION }],
        reparseOcrRaw: SAMPLE_OCR_TEXT,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen neu einlesen' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Position 1 einblenden' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Position 2 minimieren' })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('textbox', { name: 'Ziffer' })).toHaveLength(1);
  });

  it('"Alle einklappen"/"Alle ausklappen" toggle every position at once, including flagged ones (issue #207)', async () => {
    mockExcludesViolation();
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: EXCLUDES_POSITIONS.map((p) => ({ ...p })) },
    });
    await waitFor(() => expect(screen.getAllByText(EXCLUDES_605_612_MESSAGE)).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Alle einklappen' }));
    expect(screen.queryAllByRole('textbox', { name: 'Ziffer' })).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Alle ausklappen' }));
    expect(screen.getAllByRole('textbox', { name: 'Ziffer' })).toHaveLength(2);
  });

  it('automatically revalidates positions after mount, without needing a button', async () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Positionen prüfen' })).not.toBeInTheDocument();
  });

  it('re-validates again when the Ziffer of a position changes', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(lookupPosition).mockClear();

    const zifferInput = screen.getByRole('textbox', { name: 'Ziffer' });
    await user.clear(zifferInput);
    await user.type(zifferInput, '5');

    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
  });

  it('re-validates again when Anzahl changes (feeds the maxAmount/Höchstwert check)', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(lookupPosition).mockClear();

    const anzahlInput = screen.getByRole('spinbutton', { name: 'Anz.' });
    await user.clear(anzahlInput);
    await user.type(anzahlInput, '3');

    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
  });

  it('does not re-validate when an unrelated field like Beschreibung changes', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(lookupPosition).mockClear();

    await user.type(screen.getByRole('textbox', { name: 'Beschreibung' }), ' zusätzlich');

    await waitPastDebounce();
    expect(lookupPosition).not.toHaveBeenCalled();
  });

  it('shows a whole-invoice constraint violation inline (e.g. GOÄ 605+612)', async () => {
    mockExcludesViolation();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: EXCLUDES_POSITIONS.map((p) => ({ ...p })) },
    });

    // The violation is shown inline on every position it involves — here both
    // rows, since 605 and 612 are mutually excluding each other.
    await waitFor(() => expect(screen.getAllByText(EXCLUDES_605_612_MESSAGE)).toHaveLength(2));
  });

  it('highlights a position card that has a whole-invoice constraint violation', async () => {
    mockExcludesViolation();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: EXCLUDES_POSITIONS.map((p) => ({ ...p })) },
    });

    await waitFor(() => {
      const removeButtons = screen.getAllByRole('button', { name: /entfernen/i });
      for (const btn of removeButtons) {
        expect(btn.closest('[data-slot="card"]')).toHaveClass('bg-warning/10', 'ring-warning/50');
      }
    });
  });

  it('clears a shown violation once removing a position triggers a fresh revalidation', async () => {
    mockExcludesViolation();
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: EXCLUDES_POSITIONS.map((p) => ({ ...p })) },
    });
    await waitFor(() => expect(screen.getAllByText(EXCLUDES_605_612_MESSAGE)).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Position 1 entfernen' }));

    // Removing a position changes the position set, so the debounced
    // auto-revalidation effect fires again — validatePositions (back to its
    // no-violation default mock) clears the now-stale flag.
    await waitFor(() =>
      expect(screen.queryByText(EXCLUDES_605_612_MESSAGE)).not.toBeInTheDocument(),
    );
  });

  it('offers "Auslagenersatz" in the Kat.-dropdown and skips lookupPosition for it', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    // Let the initial mount's own auto-revalidation (still GOÄ) settle first.
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(lookupPosition).mockClear();

    // The Kategorie field is a shadcn (bits-ui) Select: a trigger button that opens a
    // floating-ui listbox. jsdom always reports zero-size geometry, so role-based queries
    // can't find the option — select it by its stable data-value attribute instead.
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

    // Wait past the debounce window: the auto-revalidation the category change
    // triggers must skip lookupPosition entirely for an Auslagenersatz row.
    await waitPastDebounce();
    expect(lookupPosition).not.toHaveBeenCalled();
  });

  it('does not offer "GOT" in the Kategorie dropdown (issues #183/#224)', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());

    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    await user.click(categoryTrigger);
    expect(document.querySelector('[data-value="GOÄ"]')).toBeInTheDocument();
    expect(document.querySelector('[data-value="GOZ"]')).toBeInTheDocument();
    expect(document.querySelector('[data-value="GOT"]')).not.toBeInTheDocument();

    // Close the listbox instead of leaving it open: bits-ui's body scroll-lock
    // clears `pointer-events: none` on a real (non-fake) 24ms timer, so a
    // subsequent test's click can otherwise flake if it fires just before it.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
  });

  it('still displays and keeps a legacy "GOT" row instead of blanking it', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        initialPositions: [{ ...SAMPLE_POSITION, goae_category: 'GOT' }],
      },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());

    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    // The row's own (otherwise unofferred) value must still render, not a blank placeholder.
    expect(categoryTrigger).toHaveTextContent('GOT');

    await user.click(categoryTrigger);
    expect(document.querySelector('[data-value="GOT"]')).toBeInTheDocument();
    expect(document.querySelector('[data-value="GOÄ"]')).toBeInTheDocument();
    expect(document.querySelector('[data-value="GOZ"]')).toBeInTheDocument();

    // Close the listbox instead of leaving it open: bits-ui's body scroll-lock
    // clears `pointer-events: none` on a real (non-fake) 24ms timer, so a
    // subsequent test's click can otherwise flake if it fires just before it.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
  });

  it('shows "Positionen neu einlesen" when reparseOcrRaw is provided', () => {
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        initialPositions: [{ ...SAMPLE_POSITION }],
        reparseOcrRaw: SAMPLE_OCR_TEXT,
      },
    });
    expect(screen.getByRole('button', { name: 'Positionen neu einlesen' })).toBeInTheDocument();
  });

  it('does not show "Positionen neu einlesen" when reparseOcrRaw is null', () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    expect(
      screen.queryByRole('button', { name: 'Positionen neu einlesen' }),
    ).not.toBeInTheDocument();
  });

  it('calls parseInvoice when "Positionen neu einlesen" is clicked', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        initialPositions: [{ ...SAMPLE_POSITION }],
        reparseOcrRaw: SAMPLE_OCR_TEXT,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Positionen neu einlesen' }));

    await waitFor(() => expect(parseInvoice).toHaveBeenCalledOnce());
  });

  it('calls buildIndex when the fee info icon is clicked on a position', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    // Let the initial mount's own auto-revalidation (which also calls buildIndex)
    // settle first, so the assertion below is caused by the click.
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(buildIndex).mockClear();

    await user.click(screen.getByTitle('Gebührenverzeichnis-Eintrag anzeigen'));

    await waitFor(() => expect(buildIndex).toHaveBeenCalled());
  });

  it('recalculates Betrag when Faktor changes, and Rechnungsbetrag with it', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
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
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
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
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });

    const zifferInput = screen.getByRole('textbox', { name: 'Ziffer' });
    await user.clear(zifferInput);
    await user.type(zifferInput, '5');
    await user.tab();

    await waitFor(() => expect(loadFeeTable).toHaveBeenCalledWith('GOÄ'));
  });

  it('hides Ziffer/Faktor but keeps Basis and a read-only Gesamtbetrag for Auslagenersatz', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });

    expect(screen.getByRole('textbox', { name: 'Ziffer' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Faktor' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Basis (€)' })).toBeInTheDocument();
    // GOÄ rows have a directly-editable "Betrag (€)".
    expect(screen.getByRole('spinbutton', { name: 'Betrag (€)' })).toBeInTheDocument();

    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    await user.click(categoryTrigger);
    const auslagenersatzOption = document.querySelector(
      '[data-value="Auslagenersatz"]',
    ) as HTMLElement;
    await user.click(auslagenersatzOption);
    await waitFor(() => expect(categoryTrigger).toHaveTextContent('Auslagenersatz (§10 GOÄ)'));
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));

    expect(screen.queryByRole('textbox', { name: 'Ziffer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Faktor' })).not.toBeInTheDocument();
    // Basis stays visible (amount = Anzahl × Basis); the total is now a read-only Gesamtbetrag.
    expect(screen.getByRole('spinbutton', { name: 'Basis (€)' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Anz.' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Betrag (€)' })).not.toBeInTheDocument();
    const gesamt = screen.getByRole('spinbutton', { name: 'Gesamtbetrag (€)' });
    expect(gesamt).toHaveAttribute('readonly');
  });

  it('offers "Arznei-/Hilfsmittel" and computes Gesamtbetrag = Anzahl × Basis', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    vi.mocked(lookupPosition).mockClear();

    const categoryTrigger = document.getElementById('pos-0-kategorie') as HTMLElement;
    await user.click(categoryTrigger);
    const arzneiOption = document.querySelector(
      '[data-value="Arznei-/Hilfsmittel"]',
    ) as HTMLElement;
    expect(arzneiOption).toBeInTheDocument();
    await user.click(arzneiOption);
    await waitFor(() => expect(categoryTrigger).toHaveTextContent('Arznei-/Hilfsmittel'));
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));

    // No Ziffer to look up for a non-fee-schedule category.
    await waitPastDebounce();
    expect(lookupPosition).not.toHaveBeenCalled();

    // Gesamtbetrag is read-only and recomputed from Anzahl × Basis.
    const basis = screen.getByRole('spinbutton', { name: 'Basis (€)' });
    const gesamt = screen.getByRole('spinbutton', { name: 'Gesamtbetrag (€)' });
    expect(gesamt).toHaveAttribute('readonly');
    await user.clear(basis);
    await user.type(basis, '15');
    // SAMPLE_POSITION.quantity is 2 → 2 × 15 = 30.
    await waitFor(() => expect(gesamt).toHaveValue(30));
  });
});

describe('InvoiceReview — Leistungsbereich picker (benefit_category)', () => {
  const LEISTUNGSBEREICH_LABEL = 'Leistungsbereich (Erstattung)';

  it('is hidden by default (tariff-agnostic, e.g. GOÄ-Wächter demo)', async () => {
    render(InvoiceReviewTestHarness, {
      props: { mode: 'edit', initialPositions: [{ ...SAMPLE_POSITION }] },
    });
    await waitFor(() => expect(lookupPosition).toHaveBeenCalledOnce());
    expect(screen.queryByText(LEISTUNGSBEREICH_LABEL)).not.toBeInTheDocument();
  });

  it('seeds the picker from the fee table when enabled', async () => {
    vi.mocked(lookupPosition).mockReturnValue({
      isValid: true,
      flags: [],
      feeSchedule: 'GOÄ',
      benefitCategory: 'zahnbehandlung',
    } as never);
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        showBenefitCategory: true,
        initialProviderType: 'kieferorthopaede',
        initialPositions: [{ ...SAMPLE_POSITION }],
      },
    });
    const trigger = document.getElementById('pos-0-leistungsbereich') as HTMLElement;
    expect(trigger).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveTextContent('Zahnbehandlung'));
  });

  it('falls back to the provider default when the fee table has no category', async () => {
    // A prior test's mockReturnValue persists across clearAllMocks (it clears calls,
    // not implementations), so set the no-benefitCategory return explicitly here.
    vi.mocked(lookupPosition).mockReturnValue({
      isValid: true,
      flags: [],
      feeSchedule: 'GOÄ',
    } as never);
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        showBenefitCategory: true,
        initialProviderType: 'kieferorthopaede',
        initialPositions: [{ ...SAMPLE_POSITION }],
      },
    });
    const trigger = document.getElementById('pos-0-leistungsbereich') as HTMLElement;
    await waitFor(() => expect(trigger).toHaveTextContent('Kieferorthopädie'));
  });

  it('keeps a manual override across auto-revalidation', async () => {
    // The fee-table lookup would say "ambulant", but the pinned override must win.
    vi.mocked(lookupPosition).mockReturnValue({
      isValid: true,
      flags: [],
      feeSchedule: 'GOÄ',
      benefitCategory: 'ambulant',
    } as never);
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        showBenefitCategory: true,
        initialProviderType: 'arzt',
        initialPositions: [
          { ...SAMPLE_POSITION, benefit_category: 'zahnersatz', benefit_category_overridden: true },
        ],
      },
    });
    const trigger = document.getElementById('pos-0-leistungsbereich') as HTMLElement;
    await waitFor(() => expect(trigger).toHaveTextContent('Zahnersatz'));

    // Force another revalidation via a Faktor change — the override still holds.
    const faktor = screen.getByRole('spinbutton', { name: 'Faktor' });
    await user.clear(faktor);
    await user.type(faktor, '1.8');
    await waitPastDebounce();
    expect(trigger).toHaveTextContent('Zahnersatz');
  });

  it('re-derives the automatic category when the override is reset', async () => {
    const user = userEvent.setup();
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        showBenefitCategory: true,
        initialProviderType: 'arzt',
        initialPositions: [
          { ...SAMPLE_POSITION, benefit_category: 'zahnersatz', benefit_category_overridden: true },
        ],
      },
    });
    const trigger = document.getElementById('pos-0-leistungsbereich') as HTMLElement;
    await waitFor(() => expect(trigger).toHaveTextContent('Zahnersatz'));

    await user.click(
      screen.getByRole('button', {
        name: 'Leistungsbereich für Position 1 automatisch bestimmen',
      }),
    );
    // buildIndex is mocked empty → no fee entry → provider default (arzt → ambulant).
    await waitFor(() => expect(trigger).toHaveTextContent('Ambulant'));
    // Reset removes the pin, so the reset affordance disappears.
    expect(
      screen.queryByRole('button', {
        name: 'Leistungsbereich für Position 1 automatisch bestimmen',
      }),
    ).not.toBeInTheDocument();
  });

  it('hides the picker for a flat Arznei-/Hilfsmittel position even when enabled', async () => {
    render(InvoiceReviewTestHarness, {
      props: {
        mode: 'edit',
        showBenefitCategory: true,
        initialPositions: [
          { ...SAMPLE_POSITION, goae_category: 'Arznei-/Hilfsmittel', goae_number: '' },
        ],
      },
    });
    await waitPastDebounce();
    expect(screen.queryByText(LEISTUNGSBEREICH_LABEL)).not.toBeInTheDocument();
  });
});
