// SPDX-License-Identifier: Apache-2.0
// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) with Vitest.
import '@testing-library/jest-dom/vitest';

// JSDOM does not implement the Pointer Capture API or Element.scrollIntoView; bits-ui
// primitives (e.g. Select, used inside OCRScanner/InvoiceReview) call these from
// pointer/keyboard handlers, so without stubs a user-event click on a trigger throws
// mid-handler and the popover never opens in component tests.
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
