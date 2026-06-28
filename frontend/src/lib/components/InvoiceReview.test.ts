// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildScanResult, type ScanResult } from '$lib/ocr/scan-flow';
import { textToOcrResults } from '$lib/ocr/scan-ocr';
import goaeJson from '$lib/data/goae.json';
import type { FeeScheduleTable } from '$lib/data/fee-schedule';
import type { InvoiceCreatePayload } from '@selbstbehalt/shared';
import InvoiceReview from './InvoiceReview.svelte';

const GOAE = goaeJson as unknown as FeeScheduleTable;
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

const SAMPLE = [
  'Praxis Dr. med. Mustermann',
  'Rechnungsdatum: 15.03.2026',
  '250  Blutentnahme         2,3    5,36',
  '75   Krankheitsbericht    3,5   26,53',
].join('\n');

function makeScan(): ScanResult {
  return buildScanResult(textToOcrResults(SAMPLE), 'GOÄ', GOAE);
}

const persons = [{ id: VALID_UUID, label: 'AOK · PrivatComfort' }];

describe('InvoiceReview', () => {
  it('shows the parsed header and flags the over-limit position', () => {
    render(InvoiceReview, {
      props: { scan: makeScan(), insuredPersons: persons, onSubmit: vi.fn() },
    });

    expect(screen.getByLabelText('Leistungserbringer')).toHaveValue('Praxis Dr. med. Mustermann');
    expect(screen.getByLabelText('Rechnungsdatum')).toHaveValue('2026-03-15');
    // One §5-flagged line → a notice and an inline flag reason.
    expect(screen.getByText(/Position ist auffällig/)).toBeInTheDocument();
    expect(screen.getByText(/Steigerungsfaktor/)).toBeInTheDocument();
  });

  it('emits a metadata-only payload on save, omitting the image and OCR text', async () => {
    const onSubmit = vi.fn<(p: InvoiceCreatePayload) => void>();
    render(InvoiceReview, { props: { scan: makeScan(), insuredPersons: persons, onSubmit } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0]?.[0] as InvoiceCreatePayload;
    expect(payload.insured_person_id).toBe(VALID_UUID);
    expect(payload.provider_name).toBe('Praxis Dr. med. Mustermann');
    expect(payload.positions).toHaveLength(2);
    expect(payload.ocr_raw).toBeNull();
    expect(payload).not.toHaveProperty('file_path');
  });

  it('includes the OCR raw text only when opted in', async () => {
    const onSubmit = vi.fn<(p: InvoiceCreatePayload) => void>();
    const scan = makeScan();
    render(InvoiceReview, { props: { scan, insuredPersons: persons, onSubmit } });

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect((onSubmit.mock.calls[0]?.[0] as InvoiceCreatePayload).ocr_raw).toBe(scan.ocrText);
  });

  it('does not save when there is no insured person to file under', async () => {
    const onSubmit = vi.fn();
    render(InvoiceReview, { props: { scan: makeScan(), insuredPersons: [], onSubmit } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks saving an invoice without positions', async () => {
    const onSubmit = vi.fn();
    const scan = buildScanResult(
      textToOcrResults('Praxis Dr. med. Test\nRechnungsdatum: 15.03.2026'),
      'GOÄ',
      GOAE,
    );
    render(InvoiceReview, { props: { scan, insuredPersons: persons, onSubmit } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung speichern' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('keine Positionen');
  });
});
