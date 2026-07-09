// SPDX-License-Identifier: Apache-2.0
// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) with Vitest.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// bits-ui's Dialog/AlertDialog lock body scroll while open by setting inline
// styles (padding-right, overflow, pointer-events: none) on <body>. The lock
// is released via presence/exit-animation detection, which waits for a real
// `transitionend`/animation frame that JSDOM never fires — so a dialog closed
// at the end of one test can leave the next test's page unclickable. Reset it
// unconditionally after every test.
afterEach(() => {
  document.body.removeAttribute('style');
});

// JSDOM does not implement window.matchMedia; svelte-sonner's Toaster calls it in a
// $effect. Provide a minimal stub so component tests that include the AppShell don't
// blow up with "window.matchMedia is not a function".
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

// JSDOM does not implement the Pointer Capture API or Element.scrollIntoView; bits-ui
// primitives (e.g. Select, our hand-authored HoverCard) call these from pointer/keyboard
// handlers, so without stubs a user-event click on a trigger throws mid-handler and the
// popover never opens in component tests.
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

// JSDOM does not implement ResizeObserver; LayerChart's <Chart> container measures
// itself with one to size the SVG, so chart component tests (issue #28) would throw
// on mount without this stub.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Node.js v26 defines globalThis.localStorage as a configurable getter that returns
// undefined when --localstorage-file is not provided. In vitest's jsdom environment,
// globalThis IS the jsdom window, so jsdom cannot override this getter via assignment.
// Replace it with a working in-memory Storage so any code (including settings.ts) that
// checks `typeof localStorage` at module-init time sees a usable object.
{
  const lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (lsDesc?.get && typeof localStorage === 'undefined') {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const key of Object.keys(store)) delete store[key];
        },
        get length() {
          return Object.keys(store).length;
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
      } satisfies Storage,
    });
  }
}

// Same Node.js v26 vs. jsdom conflict as above, for sessionStorage (used by
// lib/pwa/install.ts to remember an install-prompt dismissal for the session).
{
  const ssDesc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  if (ssDesc?.get && typeof sessionStorage === 'undefined') {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const key of Object.keys(store)) delete store[key];
        },
        get length() {
          return Object.keys(store).length;
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
      } satisfies Storage,
    });
  }
}
