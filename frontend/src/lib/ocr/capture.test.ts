// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CaptureError,
  captureVideoFrame,
  fileToAllImageData,
  fileToImageData,
  requestCameraStream,
  stopStream,
} from './capture';

let restoreNavigator: (() => void) | undefined;
afterEach(() => {
  restoreNavigator?.();
  restoreNavigator = undefined;
});

function setNavigator(value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  restoreNavigator = () => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  };
}

const sentinel = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;

describe('requestCameraStream', () => {
  it('throws unsupported when getUserMedia is missing', async () => {
    setNavigator({});
    await expect(requestCameraStream()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('returns the stream on success', async () => {
    const stream = { id: 'cam' } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setNavigator({ mediaDevices: { getUserMedia } });
    await expect(requestCameraStream()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    );
  });

  it('maps a denied permission', async () => {
    setNavigator({
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')),
      },
    });
    await expect(requestCameraStream()).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('maps a missing camera', async () => {
    setNavigator({
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotFoundError')),
      },
    });
    await expect(requestCameraStream()).rejects.toMatchObject({ code: 'no_camera' });
  });

  it('maps any other failure to camera_error', async () => {
    setNavigator({
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('weird')) },
    });
    await expect(requestCameraStream()).rejects.toMatchObject({
      code: 'camera_error',
      message: 'weird',
    });
  });
});

describe('stopStream', () => {
  it('stops every track', () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
    stopStream(stream);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('captureVideoFrame', () => {
  it('throws when the video has no dimensions yet', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(captureVideoFrame(video)).rejects.toMatchObject({ code: 'camera_error' });
  });

  it('rasterises the current frame via the injected canvas', async () => {
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const toImageData = vi.fn().mockReturnValue(sentinel);
    await expect(captureVideoFrame(video, { toImageData })).resolves.toBe(sentinel);
    expect(toImageData).toHaveBeenCalledWith(video, 4, 2);
  });
});

describe('fileToImageData', () => {
  it('renders PDFs by MIME type using the injected renderer', async () => {
    const file = new File([new Uint8Array([1])], 'invoice.pdf', { type: 'application/pdf' });
    const renderPdfPage = vi.fn().mockResolvedValue(sentinel);
    await expect(fileToImageData(file, { pdfPage: 3 }, { renderPdfPage })).resolves.toBe(sentinel);
    expect(renderPdfPage).toHaveBeenCalledWith(file, 3);
  });

  it('treats a .pdf extension as PDF even without a MIME type', async () => {
    const file = new File([new Uint8Array([1])], 'scan.PDF', { type: '' });
    const renderPdfPage = vi.fn().mockResolvedValue(sentinel);
    await fileToImageData(file, {}, { renderPdfPage });
    expect(renderPdfPage).toHaveBeenCalledWith(file, 1);
  });

  it('rejects non-image, non-pdf files', async () => {
    const file = new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' });
    await expect(fileToImageData(file)).rejects.toMatchObject({ code: 'unsupported_file' });
  });

  it('decodes and rasterises an image, closing the bitmap', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 3, height: 2, close });
    const toImageData = vi.fn().mockReturnValue(sentinel);
    await expect(fileToImageData(file, {}, { decode, toImageData })).resolves.toBe(sentinel);
    expect(toImageData).toHaveBeenCalledWith(
      expect.objectContaining({ width: 3, height: 2 }),
      3,
      2,
    );
    expect(close).toHaveBeenCalled();
  });

  it('maps a decode failure to decode_failed', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const decode = vi.fn().mockRejectedValue(new Error('corrupt'));
    await expect(fileToImageData(file, {}, { decode })).rejects.toMatchObject({
      code: 'decode_failed',
    });
  });

  it('CaptureError is an Error subclass with a code', () => {
    const err = new CaptureError('no_camera', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('no_camera');
  });
});

describe('fileToAllImageData', () => {
  it('delegates a PDF to renderAllPdfPages and returns all pages', async () => {
    const page1 = sentinel;
    const page2 = { data: new Uint8ClampedArray(4), width: 2, height: 1 } as unknown as ImageData;
    const file = new File([new Uint8Array([1])], 'invoice.pdf', { type: 'application/pdf' });
    const renderAllPdfPages = vi.fn().mockResolvedValue([page1, page2]);
    const results = await fileToAllImageData(file, { renderAllPdfPages });
    expect(results).toEqual([page1, page2]);
    expect(renderAllPdfPages).toHaveBeenCalledWith(file);
  });

  it('wraps a single image in a one-element array', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
    const toImageData = vi.fn().mockReturnValue(sentinel);
    const results = await fileToAllImageData(file, { decode, toImageData });
    expect(results).toEqual([sentinel]);
  });
});
