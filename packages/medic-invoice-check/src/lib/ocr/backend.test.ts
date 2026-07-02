// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectBackend, isWebGpuAvailable } from './backend';

/** Installs a fake `navigator.gpu`, returning a restore function. */
function withGpu(gpu: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: gpu === undefined ? {} : { gpu },
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  };
}

describe('isWebGpuAvailable', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('is false when navigator has no gpu', async () => {
    restore = withGpu(undefined);
    expect(await isWebGpuAvailable()).toBe(false);
  });

  it('is false when an adapter cannot be acquired', async () => {
    restore = withGpu({ requestAdapter: vi.fn().mockResolvedValue(null) });
    expect(await isWebGpuAvailable()).toBe(false);
  });

  it('is false when requestAdapter throws', async () => {
    restore = withGpu({ requestAdapter: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(await isWebGpuAvailable()).toBe(false);
  });

  it('is true when an adapter is returned', async () => {
    restore = withGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    expect(await isWebGpuAvailable()).toBe(true);
  });
});

describe('detectBackend', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('honours an explicit preference without probing WebGPU', async () => {
    const requestAdapter = vi.fn().mockResolvedValue({});
    restore = withGpu({ requestAdapter });
    expect(await detectBackend('wasm')).toBe('wasm');
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('selects webgpu when available', async () => {
    restore = withGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    expect(await detectBackend()).toBe('webgpu');
  });

  it('falls back to wasm when WebGPU is unavailable', async () => {
    restore = withGpu(undefined);
    expect(await detectBackend()).toBe('wasm');
  });
});
