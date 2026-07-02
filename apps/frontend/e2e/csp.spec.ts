// SPDX-License-Identifier: Apache-2.0
//
// Exercises the actual build-time CSP hash generator (issue #31) against the
// real build output: `vite build` is a prerequisite of `pnpm test:e2e`, so
// `build/index.html` below is always the real static file nginx would serve.
// This deliberately runs `scripts/generate-frontend-security-headers.mjs` as a
// subprocess — the same way the frontend Dockerfile invokes it — rather than
// re-hashing anything itself, so it catches the whole class of bug that
// motivated this script in the first place: the SvelteKit inline init
// `<script>` embeds Vite's content-hashed chunk filenames, so its exact bytes
// (and thus a hash of it) are NOT stable across builds/machines and can never
// safely be a value hardcoded in the checked-in template.
//
// This intentionally reads/writes files directly rather than driving a
// browser: `vite preview` — used by the other production-build checks in
// pwa.spec.ts — synthesizes a different, path-relative variant of this exact
// script for every request (to simulate arbitrary subpath deploys), so it can
// never be used to verify the literal static file's hash. That the resulting
// CSP doesn't break the app in a real browser was verified manually against
// the actual nginx image (see the PR description) — a build/serve/browser
// round-trip out of reach for a plain Playwright-without-a-browser check.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// Duplicated rather than imported from the generator script: that script is a
// plain (untyped) .mjs outside this package's TS project, and this is a
// single stable string, not worth fighting cross-project typechecking for.
const PLACEHOLDER = '__SVELTEKIT_INIT_SCRIPT_CSP_HASHES__';

const GENERATOR_SCRIPT = fileURLToPath(
  new URL('../../../scripts/generate-frontend-security-headers.mjs', import.meta.url),
);
const TEMPLATE_PATH = fileURLToPath(new URL('../security-headers.conf', import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL('../build/index.html', import.meta.url));

function inlineScriptHashesOf(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
}

test('the CSP hash generator correctly allowlists the built app shell inline script', () => {
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  expect(template).toContain(PLACEHOLDER); // sanity: guards against reverting to a hardcoded value

  const indexHtml = readFileSync(INDEX_HTML_PATH, 'utf-8');
  const expectedHashes = inlineScriptHashesOf(indexHtml);
  expect(expectedHashes.length).toBeGreaterThan(0); // fails closed if the markup/regex ever stops matching

  const tmpDir = mkdtempSync(join(tmpdir(), 'csp-header-test-'));
  const outputPath = join(tmpDir, 'security-headers.generated.conf');
  try {
    execFileSync('node', [GENERATOR_SCRIPT, INDEX_HTML_PATH, TEMPLATE_PATH, outputPath]);
    const rendered = readFileSync(outputPath, 'utf-8');

    expect(rendered).not.toContain(PLACEHOLDER);
    for (const hash of expectedHashes) {
      expect(rendered).toContain(hash);
    }
    // Nothing else about the template should have changed.
    expect(rendered).toBe(template.replaceAll(PLACEHOLDER, expectedHashes.join(' ')));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
