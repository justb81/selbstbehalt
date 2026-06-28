// SPDX-License-Identifier: Apache-2.0
/**
 * Compute-backend selection for the OCR engine (docs/design.md §2.2, issue #24).
 *
 * WebGPU is preferred for speed; when it is unavailable — older browsers, no
 * adapter, a locked-down context — we fall back to the universal WASM backend.
 * Detection is intentionally side-effect free and works in both the window and
 * the worker scope (`globalThis.navigator`).
 */
import type { OcrBackend } from './types';

/** Minimal structural view of the WebGPU entry points we probe. */
interface GpuLike {
  requestAdapter?: (options?: unknown) => Promise<unknown>;
}

function getGpu(): GpuLike | undefined {
  const nav = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator;
  return nav?.gpu;
}

/**
 * Resolves to `true` only when a WebGPU adapter can actually be acquired —
 * the presence of `navigator.gpu` alone does not guarantee a usable adapter.
 */
export async function isWebGpuAvailable(): Promise<boolean> {
  const gpu = getGpu();
  if (typeof gpu?.requestAdapter !== 'function') return false;
  try {
    const adapter = await gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

/**
 * Picks the backend to run on. A `preferred` value is honoured as a hard
 * override (e.g. `'wasm'` to force the fallback for testing or compatibility);
 * otherwise WebGPU is used when available and WASM is the fallback.
 */
export async function detectBackend(preferred?: OcrBackend): Promise<OcrBackend> {
  if (preferred) return preferred;
  return (await isWebGpuAvailable()) ? 'webgpu' : 'wasm';
}
