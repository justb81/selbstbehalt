// SPDX-License-Identifier: Apache-2.0
//
// User-adjustable client settings, persisted to localStorage. The full settings
// UI lands with #20; for now this owns the backend base-URL override that the
// API client resolves on every request.

import { writable } from 'svelte/store';

import { envApiBaseUrl, FALLBACK_API_BASE_URL } from '$lib/config.js';

const STORAGE_KEY = 'selbstbehalt:settings';

export interface Settings {
  /** Override for the backend base URL; empty → fall back to env/default. */
  apiUrl: string;
}

const DEFAULTS: Settings = { apiUrl: '' };

/** True only in a browser context with usable localStorage. */
function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function load(): Settings {
  if (!hasStorage()) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    // Corrupt/unreadable storage — start from defaults.
    return { ...DEFAULTS };
  }
}

/** Reactive settings store, hydrated from localStorage and persisted on change. */
export const settings = writable<Settings>(load());

if (hasStorage()) {
  settings.subscribe((value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Ignore persistence failures (storage disabled, quota exceeded, …).
    }
  });
}

/** Strip trailing slashes so URL paths join cleanly. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the effective backend base URL. Precedence: explicit user setting →
 * PUBLIC_API_URL (deploy-time env) → local-dev fallback.
 */
export function resolveApiBaseUrl(current: Settings = load()): string {
  const candidate = current.apiUrl.trim() || envApiBaseUrl() || FALLBACK_API_BASE_URL;
  return normalizeBaseUrl(candidate);
}
