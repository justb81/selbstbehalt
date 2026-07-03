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
// gesetze-im-internet.de's edge (juris.de) silently drops connections from
// GitHub Actions' (Azure) IP ranges — confirmed repeatedly on CI (curl:
// connection timeout, never even a TCP handshake) while the same runner
// reaches every other host instantly. A direct download therefore always
// fails there. If it fails, we fall back to the Internet Archive's Wayback
// Machine as a relay: trigger a fresh "Save Page Now" capture (the Archive's
// crawler fetches from the origin using its own egress, sidestepping the
// block) and then read back the raw bytes of that exact capture. Verified
// byte-identical to a direct download.
//
// Run: node scripts/fetch-sources.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
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

function curl(args) {
  execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Fetches `url` via the Wayback Machine: triggers a fresh capture and then
// downloads the raw bytes of that capture with the `id_` modifier (the
// unmodified content, without the Wayback toolbar/link-rewriting).
function downloadViaWaybackMachine(url, dest, tmp) {
  const headerFile = join(tmp, 'save-headers.txt');
  curl([
    '-sS',
    '--connect-timeout',
    '15',
    '--max-time',
    '60',
    '-D',
    headerFile,
    '-o',
    '/dev/null',
    `https://web.archive.org/save/${url}`,
  ]);
  const location = readFileSync(headerFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^location:/i.test(line))
    .pop()
    ?.slice('location:'.length)
    .trim();
  if (!location) throw new Error(`Wayback Machine did not return a snapshot location for ${url}`);
  const rawUrl = location.replace(/(\/web\/\d{14})\//, '$1id_/');
  curl([
    '-fsSL',
    '--connect-timeout',
    '15',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--retry-all-errors',
    '--max-time',
    '60',
    '-A',
    'selbstbehalt-fee-updater',
    '-o',
    dest,
    rawUrl,
  ]);
}

function refresh({ dir, url }) {
  const tmp = mkdtempSync(join(tmpdir(), 'fee-src-'));
  try {
    const zip = join(tmp, 'src.zip');
    // --connect-timeout bounds the connection phase on its own: without it a
    // stalled connect eats the whole --max-time per attempt. Kept short here
    // (~40s worst case) since a persistent block, not a transient blip, is
    // the common case on CI — it falls straight through to the Wayback
    // Machine fallback below rather than burning minutes retrying.
    try {
      curl([
        '-fsSL',
        '--connect-timeout',
        '10',
        '--retry',
        '2',
        '--retry-delay',
        '3',
        '--retry-all-errors',
        '--retry-max-time',
        '30',
        '--max-time',
        '20',
        '-A',
        'selbstbehalt-fee-updater',
        '-o',
        zip,
        url,
      ]);
    } catch (directErr) {
      console.warn(`Direct download of ${url} failed, falling back to the Wayback Machine…`);
      try {
        downloadViaWaybackMachine(url, zip, tmp);
      } catch (waybackErr) {
        throw new Error(
          `Failed to download ${url} directly (curl exited ${directErr.status ?? directErr.code ?? '?'}) ` +
            `and via the Wayback Machine fallback (curl exited ${waybackErr.status ?? waybackErr.code ?? '?'}). ` +
            `See the curl output above.`,
          { cause: waybackErr },
        );
      }
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
