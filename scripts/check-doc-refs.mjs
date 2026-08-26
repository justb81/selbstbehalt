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
// Usage: node scripts/check-doc-refs.mjs

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
