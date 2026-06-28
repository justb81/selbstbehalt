// SPDX-License-Identifier: Apache-2.0
//
// Refreshes the official legal-text XML under data/input/ from
// gesetze-im-internet.de. For each fee schedule it downloads the law's
// `xml.zip`, extracts the contained legal-text XML, and replaces the `.xml` in
// the matching data/input/<dir>/.
//
// Dependency-free: uses the system `curl` (built-in retry; the gii server
// occasionally answers 503) and `unzip` — both present on CI runners and no npm
// packages, matching scripts/check-licenses.mjs. Driven by
// .github/workflows/update-fee-sources.yml (monthly / on dispatch); the build
// (scripts/build-fee-schedules.mjs) then regenerates the JSON tables and the PR
// captures the diff. Can also be run locally.
//
// Run: node scripts/fetch-sources.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// gesetze-im-internet.de download slugs (verified against its gii-toc.xml).
const SOURCES = [
  { dir: 'data/input/goae', url: 'https://www.gesetze-im-internet.de/go__1982/xml.zip' },
  { dir: 'data/input/goz', url: 'https://www.gesetze-im-internet.de/goz_1987/xml.zip' },
  { dir: 'data/input/got', url: 'https://www.gesetze-im-internet.de/got_2022/xml.zip' },
];

function refresh({ dir, url }) {
  const tmp = mkdtempSync(join(tmpdir(), 'fee-src-'));
  try {
    const zip = join(tmp, 'src.zip');
    // --connect-timeout bounds the connection phase on its own: without it a
    // stalled connect (the gii host occasionally goes unreachable from CI
    // egress) eats the whole --max-time per attempt, so the retries can't ride
    // out a brief blip and the job hangs ~12 min before failing. --retry-max-time
    // caps the total retry window.
    try {
      execFileSync(
        'curl',
        [
          '-fsSL',
          '--connect-timeout',
          '30',
          '--retry',
          '5',
          '--retry-delay',
          '2',
          '--retry-all-errors',
          '--retry-max-time',
          '300',
          '--max-time',
          '120',
          '-A',
          'selbstbehalt-fee-updater',
          '-o',
          zip,
          url,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } catch (err) {
      throw new Error(
        `Failed to download ${url} (curl exited ${err.status ?? err.code ?? '?'}). ` +
          `gesetze-im-internet.de may be temporarily unreachable from this runner — ` +
          `re-run the workflow; see the curl output above.`,
        { cause: err },
      );
    }
    execFileSync('unzip', ['-o', '-q', zip, '-d', tmp]);
    // The archive may also contain PDFs (e.g. GOZ) — only the legal-text XML matters.
    const xmls = readdirSync(tmp).filter((f) => f.toLowerCase().endsWith('.xml'));
    if (xmls.length !== 1)
      throw new Error(`${url}: expected one .xml in archive, found ${xmls.length}`);
    const destDir = join(ROOT, dir);
    for (const old of readdirSync(destDir).filter((f) => f.toLowerCase().endsWith('.xml')))
      rmSync(join(destDir, old));
    copyFileSync(join(tmp, xmls[0]), join(destDir, xmls[0]));
    console.log(`${dir} ← ${url} (${xmls[0]})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const source of SOURCES) refresh(source);
console.log('sources refreshed');
