// SPDX-License-Identifier: Apache-2.0
//
// Rasterises the brand mark (static/favicon.svg) into the PNG launcher icons the
// Web App Manifest references (docs/design.md §6.3). Run on demand — the
// generated PNGs are committed, so this is not part of the build:
//
//   node scripts/generate-icons.mjs
//
// It uses the repo's already-installed Chromium (via Playwright) so there is no
// extra image-processing dependency. Two layouts are emitted:
//   - "any" icons: the rounded-square mark on a transparent canvas (192, 512px).
//   - a "maskable" icon: the mark on a full-bleed brand-blue field with a safe
//     zone, so Android's adaptive-icon mask never clips the shield.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, '../static');
const iconsDir = resolve(staticDir, 'icons');

const BRAND = '#2563eb';
// The shield + checkmark from favicon.svg, drawn on a 32×32 viewBox.
const MARK = `
  <path d="M16 5l9 3.2v6.2c0 5.6-3.7 9.7-9 11.4-5.3-1.7-9-5.8-9-11.4V8.2L16 5z"
        fill="#fff" fill-opacity="0.95" />
  <path d="M11.5 16.2l3 3 6-6.4" fill="none" stroke="${BRAND}" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round" />`;

/** "any"-purpose icon: rounded-square brand tile, transparent outside the radius. */
function anyIconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="${BRAND}" />${MARK}
  </svg>`;
}

/** Maskable icon: full-bleed brand field with the mark inside the ~80% safe zone. */
function maskableIconSvg(size) {
  // Scale the 32-unit mark to 0.66 and centre it, leaving a generous safe zone.
  const scale = 0.66;
  const offset = (32 - 32 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="${BRAND}" />
    <g transform="translate(${offset} ${offset}) scale(${scale})">${MARK}</g>
  </svg>`;
}

async function render(page, svg, size, outFile) {
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}</style>${svg}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.locator('svg').screenshot({ path: outFile, omitBackground: true });
  console.log(`wrote ${outFile}`);
}

// Use the environment's preinstalled Chromium rather than re-downloading one
// (PLAYWRIGHT_BROWSERS_PATH points at it; the version may differ from the pinned
// @playwright/test, so launch by explicit path).
const executablePath = process.env.PWA_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath });
try {
  await mkdir(iconsDir, { recursive: true });
  // Sanity-check the source mark exists so a missing favicon fails loudly.
  await readFile(resolve(staticDir, 'favicon.svg'));
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await render(page, anyIconSvg(192), 192, resolve(iconsDir, 'icon-192.png'));
  await render(page, anyIconSvg(512), 512, resolve(iconsDir, 'icon-512.png'));
  await render(page, maskableIconSvg(512), 512, resolve(iconsDir, 'icon-512-maskable.png'));
} finally {
  await browser.close();
}
