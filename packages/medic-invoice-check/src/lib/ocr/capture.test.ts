// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BEST_FRAME_SAMPLE_COUNT,
  CaptureError,
  captureBestVideoFrame,
  capturePhoto,
  captureVideoFrame,
  fileToAllPages,
  fileToImageData,
  grabPreviewFrame,
  REAR_CAMERA_CONSTRAINTS,
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

/** Never actually wait between the frames of a best-frame burst in tests. */
const noSleep = vi.fn(async () => {});

/** An opaque grayscale frame built from per-pixel luma values. */
function gray(width: number, height: number, lumas: number[]): ImageData {
  const bytes: number[] = [];
  for (const value of lumas) bytes.push(value, value, value, 255);
  return {
    data: new Uint8ClampedArray(bytes),
    width,
    height,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

/** A flat frame — no edge energy at all. */
const blurredFrame = gray(4, 4, Array<number>(16).fill(128));

/** A hard-edged checkerboard — the sharpest 4×4 pattern there is. */
const sharpFrame = gray(
  4,
  4,
  Array.from({ length: 16 }, (_, i) => (((i % 4) + Math.floor(i / 4)) % 2 === 0 ? 0 : 255)),
);

describe('REAR_CAMERA_CONSTRAINTS', () => {
  it('requests a high-resolution rear-facing stream (issue #280)', () => {
    expect(REAR_CAMERA_CONSTRAINTS).toEqual({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  });
});

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

describe('capturePhoto', () => {
  it('prefers ImageCapture.takePhoto for a full-resolution still (issue #280)', async () => {
    const track = { id: 'vid' } as unknown as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const blob = { size: 1 } as Blob;
    const close = vi.fn();
    const takePhoto = vi.fn().mockResolvedValue(blob);
    const decode = vi.fn().mockResolvedValue({ width: 10, height: 8, close });
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await expect(capturePhoto(stream, video, { takePhoto, decode, toImageData })).resolves.toBe(
      sentinel,
    );

    expect(takePhoto).toHaveBeenCalledWith(track);
    expect(decode).toHaveBeenCalledWith(blob);
    expect(toImageData).toHaveBeenCalledWith(
      expect.objectContaining({ width: 10, height: 8 }),
      10,
      8,
    );
    expect(close).toHaveBeenCalled();
  });

  it('never re-picks among video frames when takePhoto succeeded (issue #281)', async () => {
    // The still is already the better image; a best-frame burst here would
    // trade full sensor resolution for nothing.
    const track = { id: 'vid' } as unknown as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const close = vi.fn();
    const takePhoto = vi.fn().mockResolvedValue({ size: 1 } as Blob);
    const decode = vi.fn().mockResolvedValue({ width: 10, height: 8, close });
    const toImageData = vi.fn().mockReturnValue(sentinel);
    const sleep = vi.fn(async () => {});

    await capturePhoto(stream, video, { takePhoto, decode, toImageData, sleep });

    expect(toImageData).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('falls back to a best-frame burst when the stream has no video track', async () => {
    const stream = { getVideoTracks: () => [] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const takePhoto = vi.fn();
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await expect(
      capturePhoto(stream, video, { takePhoto, toImageData, sleep: noSleep }),
    ).resolves.toBe(sentinel);

    expect(takePhoto).not.toHaveBeenCalled();
    expect(toImageData).toHaveBeenCalledWith(video, 4, 2);
    expect(toImageData).toHaveBeenCalledTimes(BEST_FRAME_SAMPLE_COUNT);
  });

  it('falls back to a best-frame burst when takePhoto rejects', async () => {
    const track = {} as unknown as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const takePhoto = vi.fn().mockRejectedValue(new Error('still capture unsupported'));
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await expect(
      capturePhoto(stream, video, { takePhoto, toImageData, sleep: noSleep }),
    ).resolves.toBe(sentinel);

    expect(toImageData).toHaveBeenCalledWith(video, 4, 2);
  });

  it('falls back to a best-frame burst when ImageCapture is unavailable in this environment', async () => {
    const track = {} as unknown as MediaStreamTrack;
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 2 } as HTMLVideoElement;
    const toImageData = vi.fn().mockReturnValue(sentinel);

    // No `takePhoto` dep injected, and jsdom has no global `ImageCapture`.
    await expect(capturePhoto(stream, video, { toImageData, sleep: noSleep })).resolves.toBe(
      sentinel,
    );

    expect(toImageData).toHaveBeenCalledWith(video, 4, 2);
  });

  it('keeps the sharpest frame of the fallback burst', async () => {
    const stream = { getVideoTracks: () => [] } as unknown as MediaStream;
    const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;
    const toImageData = vi
      .fn()
      .mockReturnValueOnce(blurredFrame)
      .mockReturnValueOnce(sharpFrame)
      .mockReturnValueOnce(blurredFrame);

    await expect(capturePhoto(stream, video, { toImageData, sleep: noSleep })).resolves.toBe(
      sharpFrame,
    );
  });
});

describe('captureBestVideoFrame', () => {
  it('waits between frames so the burst spans real hand movement', async () => {
    const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;
    const sleep = vi.fn(async () => {});
    const toImageData = vi.fn().mockReturnValue(blurredFrame);

    await captureBestVideoFrame(video, { toImageData, sleep }, { count: 3, intervalMs: 50 });

    expect(toImageData).toHaveBeenCalledTimes(3);
    // Three frames, two gaps — no pointless wait before the first grab.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it('always grabs at least one frame, even when asked for none', async () => {
    const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await expect(
      captureBestVideoFrame(video, { toImageData, sleep: noSleep }, { count: 0 }),
    ).resolves.toBe(sentinel);
    expect(toImageData).toHaveBeenCalledTimes(1);
  });

  it('propagates a capture failure rather than returning a blank frame', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(captureBestVideoFrame(video, { sleep: noSleep })).rejects.toMatchObject({
      code: 'camera_error',
    });
  });
});

describe('grabPreviewFrame', () => {
  it('returns null while the stream has no dimensions yet', async () => {
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(grabPreviewFrame(video, 256)).resolves.toBeNull();
  });

  it('rasterises straight to the requested size, preserving the aspect ratio', async () => {
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await expect(grabPreviewFrame(video, 256, { toImageData })).resolves.toBe(sentinel);
    // 1920 -> 256 is a factor of 7.5; 1080 / 7.5 = 144.
    expect(toImageData).toHaveBeenCalledWith(video, 256, 144);
  });

  it('never upscales a preview that is already small', async () => {
    const video = { videoWidth: 120, videoHeight: 90 } as HTMLVideoElement;
    const toImageData = vi.fn().mockReturnValue(sentinel);

    await grabPreviewFrame(video, 256, { toImageData });
    expect(toImageData).toHaveBeenCalledWith(video, 120, 90);
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

describe('fileToAllPages', () => {
  it('delegates a PDF to extractOrRenderAllPdfPages and returns all pages', async () => {
    const page1 = { kind: 'text', lines: [] } as const;
    const page2 = { kind: 'image', image: sentinel } as const;
    const file = new File([new Uint8Array([1])], 'invoice.pdf', { type: 'application/pdf' });
    const extractOrRenderAllPdfPages = vi.fn().mockResolvedValue([page1, page2]);
    const results = await fileToAllPages(file, { extractOrRenderAllPdfPages });
    expect(results).toEqual([page1, page2]);
    expect(extractOrRenderAllPdfPages).toHaveBeenCalledWith(file);
  });

  it('wraps a single image in a one-element image page array', async () => {
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 1, height: 1, close });
    const toImageData = vi.fn().mockReturnValue(sentinel);
    const results = await fileToAllPages(file, { decode, toImageData });
    expect(results).toEqual([{ kind: 'image', image: sentinel }]);
  });
});
