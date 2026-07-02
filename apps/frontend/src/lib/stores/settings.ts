// SPDX-License-Identifier: Apache-2.0
//
// User-adjustable client settings, persisted to localStorage.

import { get, writable } from 'svelte/store';

import { envApiBaseUrl, FALLBACK_API_BASE_URL } from '$lib/config.js';

const STORAGE_KEY = 'selbstbehalt:settings';

export interface Settings {
  /** Override for the backend base URL; empty → fall back to env/default. */
  apiUrl: string;
  /** Optional X-API-Key for VPN/external access (§7.2). */
  apiKey: string;
  /** Grenzsteuersatz 0–1 (z.B. 0.25 = 25 %) für §33-EStG-Schätzung (Günstigerprüfung). */
  taxRate: number;
  /** Jährliche Diskontrate ≥ 0 (z.B. 0.03 = 3 %) für den BRE-NPV (design §5.1). */
  discountRate: number;
  /** Wahrscheinlichkeit 0–1, in einem künftigen Jahr leistungsfrei zu bleiben (design §5.2.2). */
  claimFreeProbability: number;
}

const DEFAULTS: Settings = {
  apiUrl: '',
  apiKey: '',
  taxRate: 0.25,
  discountRate: 0.03,
  claimFreeProbability: 0.7,
};

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
    return { ...DEFAULTS };
  }
}

/** Reactive settings store, hydrated once from localStorage and persisted on change. */
export const settings = writable<Settings>(load());

if (hasStorage()) {
  let initialized = false;
  settings.subscribe((value) => {
    if (!initialized) {
      initialized = true;
      return;
    }
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
export function resolveApiBaseUrl(current: Settings = get(settings)): string {
  const candidate = current.apiUrl.trim() || envApiBaseUrl() || FALLBACK_API_BASE_URL;
  return normalizeBaseUrl(candidate);
}

/** Resolve the effective X-API-Key header value, or undefined when not set. */
export function resolveApiKey(current: Settings = get(settings)): string | undefined {
  const key = current.apiKey.trim();
  return key || undefined;
}
