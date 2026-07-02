// SPDX-License-Identifier: Apache-2.0
//
// Guards the one fragile part of the CSP (issue #31): the `script-src` hash
// that allowlists SvelteKit's own inline client-init `<script>`. That hash is
// only correct as long as the script's exact content matches what
// svelte.config.js's pinned `version.name` produces — a SvelteKit upgrade
// that changes the template, or an accidental edit to `version.name`, would
// silently invalidate it and the CSP would then block the app from loading
// (`vite build` is a prerequisite of `pnpm test:e2e`, so `build/index.html`
// below is always the real static file nginx would serve). This intentionally
// reads files directly rather than driving a browser: `vite preview` — used
// by the other production-build checks in pwa.spec.ts — synthesizes a
// different, path-relative variant of this exact script for every request
// (to simulate arbitrary subpath deploys), so it can never be used to verify
// the literal static file's hash. That the resulting CSP doesn't break the
// app in a real browser was verified manually against the actual nginx image
// (see the PR description) — a build/serve/browser round-trip out of reach
// for a plain Vitest/Playwright-without-a-browser check like this one.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const SECURITY_HEADERS_CONF = readFileSync(
  fileURLToPath(new URL('../security-headers.conf', import.meta.url)),
  'utf-8',
);
const BUILT_INDEX_HTML = readFileSync(
  fileURLToPath(new URL('../build/index.html', import.meta.url)),
  'utf-8',
);

function extractCspScriptHashes(): string[] {
  const cspValue = /add_header Content-Security-Policy "([^"]+)"/.exec(SECURITY_HEADERS_CONF)?.[1];
  if (!cspValue)
    throw new Error('Content-Security-Policy not found in apps/frontend/security-headers.conf');
  const scriptSrc = /script-src ([^;]+);/.exec(cspValue)?.[1];
  if (!scriptSrc) throw new Error('script-src not found in the Content-Security-Policy value');
  return scriptSrc.match(/'sha256-[^']+'/g) ?? [];
}

function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
}

test('every inline <script> in the built app shell is covered by the CSP script-src hash allowlist', () => {
  const allowed = extractCspScriptHashes();
  const actual = inlineScriptHashes(BUILT_INDEX_HTML);
  expect(actual.length).toBeGreaterThan(0); // fails closed if the markup/regex ever stops matching
  for (const hash of actual) {
    expect(allowed).toContain(hash);
  }
});
