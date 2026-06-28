// SPDX-License-Identifier: Apache-2.0
// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) with Vitest.
import '@testing-library/jest-dom/vitest';

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
