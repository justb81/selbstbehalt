#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Substitutes the `__SVELTEKIT_INIT_SCRIPT_CSP_HASHES__` placeholder in
// apps/frontend/security-headers.conf with the SHA-256 CSP hash(es) of the
// inline <script> tag(s) actually present in the built apps/frontend/build/
// index.html (issue #31). That content embeds Vite's content-hashed chunk
// filenames (e.g. `start.<hash>.js`), so it is NOT stable across builds or
// machines — a value hardcoded at authoring time can (and did) silently go
// stale and break the app under this CSP. Run this after `vite build`; the
// frontend Dockerfile calls it as part of the image build.
//
// Usage: node scripts/generate-frontend-security-headers.mjs <indexHtmlPath> <templatePath> <outputPath>

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const PLACEHOLDER = '__SVELTEKIT_INIT_SCRIPT_CSP_HASHES__';

/** CSP `script-src` hash tokens for every inline `<script>` in `html`. */
export function extractInlineScriptCspHashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
}

/** Renders `template` with {@link PLACEHOLDER} replaced by the real hashes for `indexHtml`. */
export function renderSecurityHeadersConf(template, indexHtml) {
  const hashes = extractInlineScriptCspHashes(indexHtml);
  if (hashes.length === 0) {
    throw new Error('No inline <script> found in the built index.html — nothing to allowlist');
  }
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`${PLACEHOLDER} not found in the security-headers.conf template`);
  }
  return template.replaceAll(PLACEHOLDER, hashes.join(' '));
}

function main() {
  const [indexHtmlPath, templatePath, outputPath] = process.argv.slice(2);
  if (!indexHtmlPath || !templatePath || !outputPath) {
    console.error(
      'Usage: node generate-frontend-security-headers.mjs <indexHtmlPath> <templatePath> <outputPath>',
    );
    process.exit(1);
  }

  const indexHtml = readFileSync(indexHtmlPath, 'utf-8');
  const template = readFileSync(templatePath, 'utf-8');
  writeFileSync(outputPath, renderSecurityHeadersConf(template, indexHtml));
}

// Only run as a CLI, not when imported (e.g. by the e2e test).
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
