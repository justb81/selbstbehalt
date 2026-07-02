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
