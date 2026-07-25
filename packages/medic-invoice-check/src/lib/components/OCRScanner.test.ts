// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { assessImageQuality, QUALITY_OK_HINT, type QualityReport } from '../ocr/quality';
import { textToOcrResults } from '../ocr/scan-ocr';
import type { ScanResult } from '../ocr/scan-flow';
import type { ScanPage } from '../ocr/types';
import OCRScanner from './OCRScanner.svelte';

const SAMPLE = ['250  Blutentnahme  2,3  5,36', '75  Bericht  3,5  26,53'].join('\n');

function dummyImage(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

function imagePage(): ScanPage {
  return { kind: 'image', image: dummyImage() };
}

/**
 * A frame the quality gate (#279) waves through. Injected by every test that is
 * about something else — the one-pixel `dummyImage()` those tests use is, quite
 * correctly, judged unusable, and each of them would otherwise stop at the
 * warning instead of exercising the flow it is actually testing.
 */
const OK_QUALITY: QualityReport = {
  ok: true,
  issues: [],
  metrics: { sharpness: 500, brightness: 140, contrast: 70, clipped: 0 },
};

/** A flat mid-gray frame: no edges and no contrast, so the gate rejects it. */
function flatImage(size = 8): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
  return { data, width: size, height: size, colorSpace: 'srgb' } as unknown as ImageData;
}

/** The real verdict on {@link flatImage} — no hand-written expectations to drift. */
const BAD_QUALITY = assessImageQuality(flatImage());

function stubCameraDeps(recognizeText = SAMPLE) {
  const stream = { id: 'cam-stream' } as unknown as MediaStream;
  return {
    stream,
    requestCameraStream: vi.fn(async () => stream),
    stopStream: vi.fn(),
    capturePhoto: vi.fn(async () => dummyImage()),
    preprocess: vi.fn((img: ImageData) => img),
    recognize: vi.fn(async () => textToOcrResults(recognizeText)),
    assessQuality: vi.fn(() => OK_QUALITY),
    grabPreviewFrame: vi.fn(async () => dummyImage()),
  };
}

function stubDeps(recognizeText = SAMPLE) {
  return {
    filesToPages: vi.fn(async () => [imagePage()]),
    preprocess: vi.fn((img: ImageData) => img),
    recognize: vi.fn(async () => textToOcrResults(recognizeText)),
    assessQuality: vi.fn(() => OK_QUALITY),
  };
}

describe('OCRScanner', () => {
  it('captures a file, runs the pipeline and emits the parsed result', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    const input = screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)');
    const file = new File(['x'], 'rechnung.png', { type: 'image/png' });
    await userEvent.upload(input, file);

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.filesToPages).toHaveBeenCalledWith([file]);
    expect(deps.preprocess).toHaveBeenCalled();

    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    expect(result.schedule).toBe('GOÄ');
    expect(result.parsed.positions).toHaveLength(2);
  });

  it('auto-detects the schedule from the recognised text (issue #183)', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const dentistSample = [
      'Zahnarztpraxis Dr. Beispiel',
      '30  Eingehende Untersuchung  2,3  14,51',
    ].join('\n');
    render(OCRScanner, { props: { onScanned, deps: stubDeps(dentistSample) } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      new File(['x'], 'r.png', { type: 'image/png' }),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    expect(result.providerType).toBe('zahnarzt');
    expect(result.schedule).toBe('GOZ');
  });

  it('scans a file dropped onto the drop zone (issue #224)', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    const dropzone = screen.getByText('Rechnung hierher ziehen oder auswählen').parentElement!;
    const file = new File(['x'], 'rechnung.png', { type: 'image/png' });
    await fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.filesToPages).toHaveBeenCalledWith([file]);
  });

  it('concatenates OCR results from a multi-page PDF into one parsed invoice', async () => {
    const page1 = ['250  Blutentnahme  2,3  5,36'].join('\n');
    const page2 = ['75  Bericht  3,5  26,53'].join('\n');
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = {
      filesToPages: vi.fn(async () => [imagePage(), imagePage()]),
      preprocess: vi.fn((img: ImageData) => img),
      // Each call returns OCR results for one page.
      recognize: vi
        .fn()
        .mockResolvedValueOnce(textToOcrResults(page1))
        .mockResolvedValueOnce(textToOcrResults(page2)),
      assessQuality: vi.fn(() => OK_QUALITY),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      new File(['x'], 'rechnung.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    // Both pages' positions must appear in the single result.
    expect(result.parsed.positions).toHaveLength(2);
    expect(deps.recognize).toHaveBeenCalledTimes(2);
  });

  it('skips preprocessing/OCR for a PDF text-layer page, running it only for the scanned page (issue #278)', async () => {
    const textLines = textToOcrResults(['250  Blutentnahme  2,3  5,36'].join('\n'));
    const scannedPage = ['75  Bericht  3,5  26,53'].join('\n');
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const preprocess = vi.fn((img: ImageData) => img);
    const recognize = vi.fn(async () => textToOcrResults(scannedPage));
    const deps = {
      filesToPages: vi.fn(async (): Promise<ScanPage[]> => [
        { kind: 'text', lines: textLines },
        imagePage(),
      ]),
      preprocess,
      recognize,
      assessQuality: vi.fn(() => OK_QUALITY),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      new File(['x'], 'rechnung.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    // Only the image page went through preprocessing/OCR.
    expect(preprocess).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledTimes(1);
    const result = onScanned.mock.calls[0]?.[0] as ScanResult;
    expect(result.parsed.positions).toHaveLength(2);
  });

  it('surfaces a recognition failure without emitting a result', async () => {
    const onScanned = vi.fn();
    const deps = stubDeps();
    deps.recognize = vi.fn(async () => {
      throw new Error('OCR kaputt');
    });
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      new File(['x'], 'r.png', { type: 'image/png' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('OCR kaputt');
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('scans an `autoFile` immediately on mount, without user interaction', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubDeps();
    const autoFile = new File(['x'], 'geteilte-rechnung.pdf', { type: 'application/pdf' });
    render(OCRScanner, { props: { onScanned, deps, autoFile } });

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.filesToPages).toHaveBeenCalledWith([autoFile]);
  });
});

// One dedicated photo entry point ("Rechnung fotografieren") vs. one dedicated
// file entry point ("Datei/PDF wählen", tested above) — issue #280.
describe('OCRScanner camera capture (issue #280)', () => {
  it('opens the in-app camera preview via the dedicated photo entry point', async () => {
    const onScanned = vi.fn();
    const deps = stubCameraDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));

    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Aufnehmen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('captures a photo via the injected capturePhoto, releases the camera and emits the result', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubCameraDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }));
    // The shutter only adds a sheet — recognition starts on "Fertig".
    await userEvent.click(await screen.findByRole('button', { name: 'Fertig – erkennen' }));

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.capturePhoto).toHaveBeenCalledWith(deps.stream, expect.anything());
    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);
  });

  it('releases the camera on cancel without scanning', async () => {
    const onScanned = vi.fn();
    const deps = stubCameraDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);
    expect(deps.capturePhoto).not.toHaveBeenCalled();
    expect(onScanned).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rechnung fotografieren' })).toBeInTheDocument();
  });

  it('releases the camera when torn down mid-preview (LED must not stay on)', async () => {
    const onScanned = vi.fn();
    const deps = stubCameraDeps();
    const { unmount } = render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());

    unmount();

    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);
  });

  it('releases the camera and surfaces an error when capturePhoto fails', async () => {
    const onScanned = vi.fn();
    const deps = stubCameraDeps();
    deps.capturePhoto = vi.fn(async () => {
      throw new Error('Kamerabild ist noch nicht bereit.');
    });
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Kamerabild ist noch nicht bereit.');
    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);
    expect(onScanned).not.toHaveBeenCalled();
  });
});

describe('OCRScanner capture-quality gate (issue #279)', () => {
  const uploadFile = async (): Promise<void> => {
    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      new File(['x'], 'rechnung.png', { type: 'image/png' }),
    );
  };

  it('warns before recognising instead of burning an OCR run on an unusable frame', async () => {
    const onScanned = vi.fn();
    const deps = { ...stubDeps(), assessQuality: vi.fn(() => BAD_QUALITY) };
    render(OCRScanner, { props: { onScanned, deps } });

    await uploadFile();

    expect(
      await screen.findByText('Die Vorlage könnte für die Erkennung zu schlecht sein'),
    ).toBeInTheDocument();
    // Every problem the metrics found is spelled out, not just the first.
    for (const issue of BAD_QUALITY.issues) {
      expect(screen.getByText(issue.hint)).toBeInTheDocument();
    }
    expect(deps.recognize).not.toHaveBeenCalled();
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('recognises anyway when the user overrides the warning (never blocking)', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = { ...stubDeps(), assessQuality: vi.fn(() => BAD_QUALITY) };
    render(OCRScanner, { props: { onScanned, deps } });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Trotzdem erkennen' }));

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.recognize).toHaveBeenCalledOnce();
  });

  it('discards the frame and returns to the file entry point on retake', async () => {
    const onScanned = vi.fn();
    const deps = { ...stubDeps(), assessQuality: vi.fn(() => BAD_QUALITY) };
    render(OCRScanner, { props: { onScanned, deps } });

    await uploadFile();
    await userEvent.click(await screen.findByRole('button', { name: 'Andere Dateien wählen' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rechnung fotografieren' })).toBeInTheDocument(),
    );
    expect(deps.recognize).not.toHaveBeenCalled();
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('offers a retake through the camera when the frame came from the camera', async () => {
    const onScanned = vi.fn();
    const stream = { id: 'cam-stream' } as unknown as MediaStream;
    const deps = {
      requestCameraStream: vi.fn(async () => stream),
      stopStream: vi.fn(),
      capturePhoto: vi.fn(async () => dummyImage()),
      grabPreviewFrame: vi.fn(async () => dummyImage()),
      preprocess: vi.fn((img: ImageData) => img),
      recognize: vi.fn(async () => textToOcrResults(SAMPLE)),
      assessQuality: vi.fn(() => BAD_QUALITY),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Fertig – erkennen' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Neu aufnehmen' }));

    // Straight back into the preview rather than out to the drop zone.
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledTimes(2));
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('never warns about a PDF read entirely from its text layer (no image to fault)', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const assessQuality = vi.fn(() => BAD_QUALITY);
    const deps = {
      filesToPages: vi.fn(async (): Promise<ScanPage[]> => [
        { kind: 'text', lines: textToOcrResults(SAMPLE) },
      ]),
      preprocess: vi.fn((img: ImageData) => img),
      recognize: vi.fn(async () => []),
      assessQuality,
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await uploadFile();

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(assessQuality).not.toHaveBeenCalled();
  });
});

describe('OCRScanner live capture hints (issue #281)', () => {
  function stubLiveDeps(quality: QualityReport) {
    const stream = { id: 'cam-stream' } as unknown as MediaStream;
    return {
      stream,
      requestCameraStream: vi.fn(async () => stream),
      stopStream: vi.fn(),
      capturePhoto: vi.fn(async () => dummyImage()),
      grabPreviewFrame: vi.fn(async () => dummyImage()),
      preprocess: vi.fn((img: ImageData) => img),
      recognize: vi.fn(async () => textToOcrResults(SAMPLE)),
      assessQuality: vi.fn(() => quality),
    };
  }

  it('shows the root-cause hint while the preview is poor', async () => {
    const deps = stubLiveDeps(BAD_QUALITY);
    render(OCRScanner, { props: { onScanned: vi.fn(), deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));

    expect(await screen.findByText(BAD_QUALITY.issues[0]!.liveHint)).toBeInTheDocument();
  });

  it('shows the all-clear once the preview passes', async () => {
    const deps = stubLiveDeps(OK_QUALITY);
    render(OCRScanner, { props: { onScanned: vi.fn(), deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));

    expect(await screen.findByText(QUALITY_OK_HINT)).toBeInTheDocument();
  });

  it('stops sampling once the preview is torn down', async () => {
    const deps = stubLiveDeps(OK_QUALITY);
    render(OCRScanner, { props: { onScanned: vi.fn(), deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await screen.findByText(QUALITY_OK_HINT);

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    const callsAtCancel = deps.grabPreviewFrame.mock.calls.length;

    // Well past one sampling interval: a retired loop must not tick again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(deps.grabPreviewFrame).toHaveBeenCalledTimes(callsAtCancel);
    expect(screen.queryByText(QUALITY_OK_HINT)).not.toBeInTheDocument();
  });
});

describe('OCRScanner multi-page image invoices', () => {
  const twoFiles = (): File[] => [
    new File(['a'], 'seite-1.png', { type: 'image/png' }),
    new File(['b'], 'seite-2.png', { type: 'image/png' }),
  ];

  it('scans a multi-sheet paper invoice picked as several files as one invoice', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = {
      ...stubDeps(),
      filesToPages: vi.fn<(files: File[]) => Promise<ScanPage[]>>(async () => [
        imagePage(),
        imagePage(),
      ]),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      twoFiles(),
    );

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    // The whole selection goes to the loader in one call, and both pages'
    // lines land in a single parsed invoice.
    expect(deps.filesToPages).toHaveBeenCalledOnce();
    expect(deps.filesToPages.mock.calls[0]?.[0]).toHaveLength(2);
    expect(deps.recognize).toHaveBeenCalledTimes(2);
  });

  // A file picker's FileList order is browser-defined, and a plain
  // lexicographic sort puts "10" before "2".
  it('orders a picked selection numerically by filename', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = {
      ...stubDeps(),
      filesToPages: vi.fn<(files: File[]) => Promise<ScanPage[]>>(async () => [imagePage()]),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'), [
      new File(['c'], 'seite-10.png', { type: 'image/png' }),
      new File(['a'], 'seite-2.png', { type: 'image/png' }),
    ]);

    await waitFor(() => expect(deps.filesToPages).toHaveBeenCalledOnce());
    const names = deps.filesToPages.mock.calls[0]![0].map((f) => f.name);
    expect(names).toEqual(['seite-2.png', 'seite-10.png']);
  });

  it('keeps the drop order, which the user chose', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = {
      ...stubDeps(),
      filesToPages: vi.fn<(files: File[]) => Promise<ScanPage[]>>(async () => [imagePage()]),
    };
    const { container } = render(OCRScanner, { props: { onScanned, deps } });

    const dropzone = container.querySelector('[role="presentation"]')!;
    await fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(['c'], 'seite-10.png', { type: 'image/png' }),
          new File(['a'], 'seite-2.png', { type: 'image/png' }),
        ],
      },
    });

    await waitFor(() => expect(deps.filesToPages).toHaveBeenCalledOnce());
    const names = deps.filesToPages.mock.calls[0]![0].map((f) => f.name);
    expect(names).toEqual(['seite-10.png', 'seite-2.png']);
  });

  it('does nothing when the selection is empty', async () => {
    const onScanned = vi.fn();
    const deps = stubDeps();
    const { container } = render(OCRScanner, { props: { onScanned, deps } });

    const dropzone = container.querySelector('[role="presentation"]')!;
    await fireEvent.drop(dropzone, { dataTransfer: { files: [] } });

    expect(deps.filesToPages).not.toHaveBeenCalled();
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('shoots several sheets in one camera session before recognising', async () => {
    const onScanned = vi.fn<(r: ScanResult) => void>();
    const deps = stubCameraDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }));
    // The camera stays open, and the shutter now offers another sheet.
    expect(deps.stopStream).not.toHaveBeenCalled();
    expect(await screen.findByText(/1 Seite aufgenommen/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Weitere Seite aufnehmen' }));
    expect(await screen.findByText(/2 Seiten aufgenommen/)).toBeInTheDocument();
    expect(onScanned).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Fertig – erkennen' }));

    await waitFor(() => expect(onScanned).toHaveBeenCalledOnce());
    expect(deps.capturePhoto).toHaveBeenCalledTimes(2);
    expect(deps.recognize).toHaveBeenCalledTimes(2);
    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);
  });

  it('discards sheets already shot when the camera is cancelled', async () => {
    const onScanned = vi.fn();
    const deps = stubCameraDeps();
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onScanned).not.toHaveBeenCalled();
    expect(deps.stopStream).toHaveBeenCalledWith(deps.stream);

    // Re-entering the camera starts from zero, not from the abandoned sheet.
    await userEvent.click(screen.getByRole('button', { name: 'Rechnung fotografieren' }));
    await waitFor(() => expect(deps.requestCameraStream).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/aufgenommen/)).not.toBeInTheDocument();
  });

  it('names the offending sheet when only one page of several is unusable', async () => {
    const onScanned = vi.fn();
    let call = 0;
    const deps = {
      ...stubDeps(),
      filesToPages: vi.fn(async () => [imagePage(), imagePage()]),
      // First sheet fine, second unusable.
      assessQuality: vi.fn(() => (call++ === 0 ? OK_QUALITY : BAD_QUALITY)),
    };
    render(OCRScanner, { props: { onScanned, deps } });

    await userEvent.upload(
      screen.getByLabelText('Rechnungsdateien (Bilder oder PDFs)'),
      twoFiles(),
    );

    expect(await screen.findByText(/Betrifft Seite 2 von 2/)).toBeInTheDocument();
    expect(onScanned).not.toHaveBeenCalled();
  });
});
