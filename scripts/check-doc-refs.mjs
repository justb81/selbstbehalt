// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0

// Verifies the §-references into docs/architecture.md across the whole repository.
//
// docs/architecture.md is the single source of truth for architecture, data model and
// domain logic (arc42, twelve chapters), and it is cited from ~140 files — mostly as a
// one-line §-reference in a file header. Nothing else in CI notices when such a
// reference goes stale: `ci.yml` deliberately skips documentation changes
// (`paths-ignore`), so a renumbered chapter or a renamed file would silently invalidate
// hundreds of pointers. This script closes that gap. It runs from headers.yml, which has
// no paths-ignore and therefore fires on every change.
//
// Two checks:
//   1. Every §N cited alongside a mention of the architecture doc resolves to a heading
//      that actually exists in it.
//   2. No file still points at the doc's former name, docs/design.md.
//
// Both run code → doc: does every pointer out of the code still land somewhere? The
// `--affected` mode runs the *other* direction, doc → changed code, and is advisory
// rather than a gate (issue #463). It exists because that gap is what actually goes
// stale: a change updates the chapter whose name it shares — the endpoint list for a new
// endpoint — and silently leaves the cross-cutting chapters that describe the *behaviour*
// it altered, which name no endpoint and so turn up in no search for the new thing. It
// cannot be a gate: plenty of changes legitimately need no documentation edit, and a
// check that cries wolf gets ticked past. So it stays quiet unless a doc passage actually
// mentions a file the change touched, and then it prints that passage and exits 0.
//
// Usage: node scripts/check-doc-refs.mjs             — the gate (both checks above)
//        node scripts/check-doc-refs.mjs --affected  — advisory reverse index
//          Compares against DOCS_AFFECTED_BASE (default `origin/main`).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'docs/architecture.md';
const OLD_DOC_NAME = 'design.md';

// Excluded, each for a stated reason — mirroring how check-spdx-headers.mjs keeps its
// exclusions justified in place.
const EXCLUDED = [
  // Legal-text exports and the fee-schedule tables generated from them: full of
  // §-citations of the GOÄ/GOZ/GOT themselves, none of them pointing here.
  (p) => p.startsWith('data/'),
  (p) => /^packages\/medic-invoice-check\/src\/lib\/data\/(goae|goz|got)\.json$/.test(p),
  // Release history: a record of what was written at the time, not a live reference.
  (p) => p === 'CHANGELOG.md',
  // This script's own documentation of the check.
  (p) => p === 'scripts/check-doc-refs.mjs',
];

// docs/data-format.md carries its own, independent §-numbering (§5.2.1 there is a
// section of that file, not of the architecture doc). References to it always name the
// file, so they are recognised by prefix rather than excluded wholesale.
const FOREIGN_NAMESPACE = /(data-format\.md|privacy-threat-model\.md)[`)\]]*\s*§/;

// Citations of the fee schedules and other statutes — §5 GOÄ, §9-GOZ, §33-EStG,
// §286 Abs. 3 BGB, § 5 UrhG — share the § sign with chapter references and routinely
// sit on the same line as one. They are always single-number, so stripping that shape
// leaves every §x.y chapter reference intact.
const STATUTE =
  /§\s?\d+[a-z]?(?!\.\d)(\(\d+\))?[^§\n]{0,20}?\b(GOÄ|GOZ|GOT|EStG|BGB|UrhG|DSGVO|SGB|UStG|Steigerungsfaktor)\b/g;

// ---------------------------------------------------------------------------
// Advisory reverse index: which documentation describes the code this change touches?
// ---------------------------------------------------------------------------

// Basenames that identify nothing: every package has an `index.ts` and every route a
// `+page.svelte`, so matching on them would bury the real hits under every mention.
const GENERIC_BASENAMES = new Set([
  'index',
  'app',
  'utils',
  'types',
  'schema',
  'config',
  'client',
  'constants',
  'helpers',
  '+page',
  '+layout',
  '+server',
  '+error',
  'README',
  'CHANGELOG',
]);

/** Files whose change says nothing about the prose: the prose itself, and lockfiles. */
const NOT_A_SOURCE = (p) =>
  p.startsWith('docs/') || p.endsWith('.md') || p.endsWith('lock.yaml') || p.startsWith('data/');

/** `apps/x/src/lib/utils/partial-load.test.ts` → `partial-load`; `ErrorState.svelte` → `ErrorState`. */
function identifierOf(path) {
  const base = path.split('/').pop() ?? '';
  const stem = base.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '');
  return GENERIC_BASENAMES.has(stem) ? null : stem;
}

/** Matches the identifier as its own token, so `stats` does not hit `statsWorker`. */
function tokenPattern(identifier) {
  return new RegExp(`(^|[^\\w-])${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`);
}

// Only code-shaped mentions count: a backticked span, a filename, or a path. The domain
// words double as identifiers here — `invoices`, `insured`, `scan` — so matching plain
// prose would bury the two lines that actually describe a module under sixty that merely
// use the German noun. A dump that long gets skimmed, which is the failure this is meant
// to prevent.
const CODEISH =
  /`[^`]+`|[\w./+[\]-]*\.(?:ts|mts|cts|js|mjs|cjs|svelte|json|css|html|ya?ml)\b|\/[\w./+[\]-]+/g;

/** Hits beyond this per identifier are counted, not listed. */
const MAX_HITS = 12;

function reportAffectedDocs() {
  const base = process.env.DOCS_AFFECTED_BASE || 'origin/main';
  let changed;
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    console.log(
      `Cannot diff against ${base} (shallow clone or unknown ref) — reverse index skipped.`,
    );
    return;
  }

  const docs = tracked
    .filter((p) => p.startsWith('docs/') && p.endsWith('.md'))
    .map((p) => ({ path: p, lines: readFileSync(p, 'utf8').split('\n') }));

  // One identifier can come from several changed files (a module and its test); report
  // it once, naming the change that introduced it.
  const seen = new Map();
  for (const path of changed) {
    if (NOT_A_SOURCE(path)) continue;
    const identifier = identifierOf(path);
    if (identifier && !seen.has(identifier)) seen.set(identifier, path);
  }

  const findings = [];
  for (const [identifier, path] of seen) {
    const pattern = tokenPattern(identifier);
    const hits = [];
    for (const doc of docs) {
      for (const [i, line] of doc.lines.entries()) {
        const codeish = (line.match(CODEISH) ?? []).join(' ');
        if (codeish && pattern.test(codeish)) {
          hits.push(`${doc.path}:${i + 1}: ${line.trim().slice(0, 110)}`);
        }
      }
    }
    if (hits.length > 0) findings.push({ identifier, path, hits });
  }

  if (findings.length === 0) {
    console.log(`No documentation mentions the files changed against ${base}.`);
    return;
  }

  console.log(`Documentation that mentions code changed against ${base} — check each passage`);
  console.log('still describes what the code now does:\n');
  for (const { identifier, path, hits } of findings) {
    console.log(`  ${path}  (as "${identifier}")`);
    for (const hit of hits.slice(0, MAX_HITS)) console.log(`    ${hit}`);
    if (hits.length > MAX_HITS) console.log(`    … and ${hits.length - MAX_HITS} more`);
    console.log('');
  }
  console.log(
    `${findings.length} changed file(s) are described somewhere in docs/. Advisory only.`,
  );
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((p) => !EXCLUDED.some((skip) => skip(p)));

/** The §-numbers the architecture doc actually defines, e.g. "8.5.1". */
function definedSections() {
  const sections = new Set();
  for (const line of readFileSync(DOC, 'utf8').split('\n')) {
    const m = /^#{2,5}\s+(\d+(?:\.\d+)*)\.?\s+\S/.exec(line);
    if (m) {
      sections.add(m[1]);
      // A chapter reference such as §8 is valid even when only §8.1 has a heading.
      const parts = m[1].split('.');
      for (let i = 1; i < parts.length; i++) sections.add(parts.slice(0, i).join('.'));
    }
  }
  return sections;
}

if (process.argv.includes('--affected')) {
  reportAffectedDocs();
  process.exit(0);
}

const defined = definedSections();
const problems = [];

for (const path of tracked) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue; // unreadable or binary — nothing to check
  }
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    const where = `${path}:${i + 1}`;

    if (line.includes(OLD_DOC_NAME)) {
      problems.push(`${where}: refers to "${OLD_DOC_NAME}"; the file is now ${DOC}`);
    }

    // Only lines that name the architecture doc are checked — by filename, or by the
    // "architecture §8.4" / "the architecture doc" shorthand the source comments use.
    // A bare §5 elsewhere is almost always §5 GOÄ (the Steigerungsfaktor) and none of
    // this script's business.
    const namesDoc = /architecture\.md|\b[Aa]rchitecture §|\bArchitektur §|architecture doc/.test(
      line,
    );
    if (!namesDoc || FOREIGN_NAMESPACE.test(line)) continue;
    for (const m of line.replace(STATUTE, '').matchAll(/§\s?(\d+(?:\.\d+)*)/g)) {
      if (!defined.has(m[1])) {
        problems.push(`${where}: §${m[1]} is not a chapter of ${DOC}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Stale references into ${DOC}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\n${problems.length} problem(s). Fix the reference, or add the chapter to ${DOC}.`,
  );
  process.exit(1);
}

console.log(`All §-references into ${DOC} resolve, and no file names ${OLD_DOC_NAME}.`);
