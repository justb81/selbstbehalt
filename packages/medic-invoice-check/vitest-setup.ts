// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) with Vitest.
import '@testing-library/jest-dom/vitest';

// JSDOM does not implement the Pointer Capture API or Element.scrollIntoView; bits-ui
// primitives (e.g. Select) call these from pointer/keyboard handlers, so without stubs a
// user-event click on a trigger throws mid-handler and the popover never opens.
if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype;
  if (!proto.hasPointerCapture) {
    proto.hasPointerCapture = () => false;
  }
  if (!proto.setPointerCapture) {
    proto.setPointerCapture = () => {};
  }
  if (!proto.releasePointerCapture) {
    proto.releasePointerCapture = () => {};
  }
  if (!proto.scrollIntoView) {
    proto.scrollIntoView = () => {};
  }
}

// jsdom ≥31 renders <canvas> through @napi-rs/canvas whenever that package is
// resolvable — and it is, as a transitive dependency of ppu-paddle-ocr (→ ppu-ocv).
// Its 2D context then rejects the structural ImageData fixtures the component tests
// hand to InvoicePagePreview (`putImageData: parameter 1 is not of type
// 'ImageData'`). Those tests assert markup and accessibility, never pixels, and were
// written for a canvas-less jsdom, so restore that contract: `getContext` yields no
// context, and the component's own `if (!context) return` guard takes over — the same
// path a browser without a 2D context takes.
if (typeof window !== 'undefined') {
  window.HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
}

// JSDOM does not implement window.matchMedia; some bits-ui primitives read it in an
// effect. Provide a minimal stub so component tests don't blow up on mount.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
