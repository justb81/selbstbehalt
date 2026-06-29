// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { textToOcrResults } from '$lib/ocr/scan-ocr';
import type { ScanResult } from '$lib/ocr/scan-flow';
import OCRScanner from './OCRScanner.svelte';

const SAMPLE = ['250  Blutentnahme  2,3  5,36', '75  Bericht  3,5  26,53'].join('\n');

function dummyImage(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

function stubDeps(recognizeText = SAMPLE) {
  return {
    fileToImages: vi.fn(async () => [dummyImage()]),
    preprocess: vi.fn((img: ImageData) => img),
    recognize: vi.fn(async () => textToOcrResults(recognizeText)),
  };
}

describe('OCRScanner', () => {
  it('captures a file, runs the pipeline and emits the parsed result', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    const input = screen.getByLabelText('Rechnungsdatei (Bild oder PDF)');
    const file = new File(['x'], 'rechnung.png', { type: 'image/png' });
    await userEvent.upload(input, file);

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.fileToImages).toHaveBeenCalledWith(file);
    expect(deps.preprocess).toHaveBeenCalled();

    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    expect(result.schedule).toBe('GOÄ');
    expect(result.parsed.positions).toHaveLength(2);
  });

  it('parses against the selected schedule', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    // The schedule selector is a shadcn Select (bits-ui custom component), not a
    // native <select>, so userEvent.selectOptions does not work in jsdom. Pass the
    // schedule prop directly to test the parsing behaviour in isolation.
    render(OCRScanner, { props: { onScanned, deps: stubDeps(), schedule: 'GOZ' } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdatei (Bild oder PDF)'),
      new File(['x'], 'r.png', { type: 'image/png' }),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect((onScanned.mock.calls[0]?.[0] as ScanResult).schedule).toBe('GOZ');
  });

  it('concatenates OCR results from a multi-page PDF into one parsed invoice', async () => {
    const page1 = ['250  Blutentnahme  2,3  5,36'].join('\n');
    const page2 = ['75  Bericht  3,5  26,53'].join('\n');
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = {
      fileToImages: vi.fn(async () => [dummyImage(), dummyImage()]),
      preprocess: vi.fn((img: ImageData) => img),
      // Each call returns OCR results for one page.
      recognize: vi
        .fn()
        .mockResolvedValueOnce(textToOcrResults(page1))
        .mockResolvedValueOnce(textToOcrResults(page2)),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdatei (Bild oder PDF)'),
      new File(['x'], 'rechnung.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    // Both pages' positions must appear in the single result.
    expect(result.parsed.positions).toHaveLength(2);
    expect(deps.recognize).toHaveBeenCalledTimes(2);
  });

  it('surfaces a recognition failure without emitting a result', async () => {
    const onScanned = vi.fn();
    const deps = stubDeps();
    deps.recognize = vi.fn(async () => {
      throw new Error('OCR kaputt');
    });
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdatei (Bild oder PDF)'),
      new File(['x'], 'r.png', { type: 'image/png' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('OCR kaputt');
    expect(onScanned).not.toHaveBeenCalled();
  });
});
