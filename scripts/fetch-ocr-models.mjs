// SPDX-License-Identifier: Apache-2.0
//
// Downloads the on-device PP-OCRv5 model assets into every app's
// static/models/ocr/ (apps/frontend and apps/goae-waechter — issue #170) so the
// OCR pipeline (docs/design.md §4, issue #27) can run client-side without ever
// fetching a model from a third-party CDN at runtime (CLAUDE.md privacy
// constraint; §1.3/§8). The files are large binaries and are git-ignored —
// re-run this script to (re)populate them.
//
// Source: the ppu-paddle-ocr model release repo. We pick the PP-OCRv5 *mobile*
// detection model plus the *Latin* recognition model + dictionary, which cover
// German (Latin-script) invoices. Binaries live behind Git LFS, so they are
// fetched from the `media.githubusercontent.com/media/...` LFS endpoint; the
// plain-text dictionary comes from `raw.githubusercontent.com`.
//
// Each asset is downloaded once, verified against the SHA-256 pinned in
// apps/frontend/static/models/ocr/models.sha256 (the canonical hash list — both
// apps serve the identical models, so one hash list covers both), then copied
// into every destination app. A mismatch (supply-chain substitution, LFS
// corruption, truncated download) deletes the bad file and fails. When
// intentionally refreshing the models, update models.sha256 to the new hashes.
//
// Dependency-free: uses the system `curl` (matches scripts/fetch-sources.mjs).
//
// Run: node scripts/fetch-ocr-models.mjs   (or: pnpm ocr:models)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Every app that serves the OCR models from its own static/models/ocr/. Keep in
// sync with COPY_ORT_WASM's DEST_APPS.
const DEST_APPS = ['apps/frontend', 'apps/goae-waechter'];
const DEST_DIRS = DEST_APPS.map((app) => join(ROOT, app, 'static/models/ocr'));
// The canonical hash list lives with the first app; the rest just receive a copy.
const HASH_DIR = DEST_DIRS[0];

const LFS =
  'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';
const RAW = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';

// Served filename ← upstream path. Keep in sync with DEFAULT_MODEL_URLS in
// packages/medic-invoice-check/src/lib/ocr/types.ts and static/models/ocr/README.md.
const ASSETS = [
  { out: 'det.onnx', url: `${LFS}/detection/PP-OCRv5_mobile_det_infer.onnx` },
  {
    out: 'rec.onnx',
    url: `${LFS}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`,
  },
  { out: 'dict.txt', url: `${RAW}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt` },
];

/** Parses `models.sha256` (`<hex>  <filename>` per line) into a name→hash map. */
function loadExpectedHashes() {
  const text = readFileSync(join(HASH_DIR, 'models.sha256'), 'utf8');
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (m) map.set(m[2].trim(), m[1].toLowerCase());
  }
  return map;
}

const expected = loadExpectedHashes();
for (const dir of DEST_DIRS) mkdirSync(dir, { recursive: true });

for (const { out, url } of ASSETS) {
  const want = expected.get(out);
  if (!want) throw new Error(`No SHA-256 pinned for ${out} in models.sha256 — refusing to fetch.`);

  const dest = join(HASH_DIR, out);
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
        '600',
        '-A',
        'selbstbehalt-ocr-model-fetcher',
        '-o',
        dest,
        url,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch (err) {
    throw new Error(
      `Failed to download ${url} (curl exited ${err.status ?? err.code ?? '?'}). ` +
        `The model host may be temporarily unreachable — re-run; see the curl output above.`,
      { cause: err },
    );
  }

  const got = createHash('sha256').update(readFileSync(dest)).digest('hex');
  if (got !== want) {
    rmSync(dest, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${out}: expected ${want}, got ${got}. ` +
        `The download was deleted. If you intentionally changed the model source, ` +
        `update apps/frontend/static/models/ocr/models.sha256.`,
    );
  }

  // Fan the verified download out to every other destination app.
  for (const dir of DEST_DIRS.slice(1)) {
    copyFileSync(dest, join(dir, out));
  }
  console.log(`${out} ← ${url} (sha256 ok) → ${DEST_APPS.join(', ')}`);
}

console.log('OCR models fetched and verified');
