// SPDX-License-Identifier: Apache-2.0
//
// License-compliance gate for selbstbehalt.
//
// selbstbehalt ships under Apache-2.0 and must only redistribute dependencies
// under OSI-approved, permissive licenses (see docs/design.md §10). This script
// enumerates the licenses of all *production* (redistributed) dependencies via
// `pnpm licenses list` and fails if any falls outside the allowlist below.
//
// Dev dependencies (build/test tooling) are intentionally excluded: they are not
// shipped to users, so their licenses do not affect the distributed artifact.
//
// Run: `node scripts/check-licenses.mjs`. No external packages required.

import { execFileSync } from 'node:child_process';

// SPDX identifiers we accept. Permissive + weak-copyleft licenses that are
// compatible with redistribution inside an Apache-2.0 project.
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

// Per-package overrides for dependencies that declare a non-SPDX or missing
// license string but are known to be acceptable. Keep this list empty unless a
// real case demands it, and document the reason inline.
const PACKAGE_OVERRIDES = new Map([
  // 'some-pkg@1.2.3': 'MIT — license file present, package.json field malformed',
]);

/**
 * Evaluate an SPDX license expression against the allowlist.
 * Handles simple `OR`/`AND` compounds and parentheses:
 *   - `A OR B`  → allowed if *either* side is allowed
 *   - `A AND B` → allowed only if *both* sides are allowed
 */
function isAllowedExpression(expr) {
  if (!expr) return false;
  const cleaned = expr.replace(/[()]/g, ' ').trim();
  if (ALLOWED.has(cleaned)) return true;

  if (/\bOR\b/i.test(cleaned)) {
    return cleaned.split(/\bOR\b/i).some((part) => isAllowedExpression(part.trim()));
  }
  if (/\bAND\b/i.test(cleaned)) {
    return cleaned.split(/\bAND\b/i).every((part) => isAllowedExpression(part.trim()));
  }
  // Tolerate a trailing `+` (e.g. `Apache-2.0+`).
  return ALLOWED.has(cleaned.replace(/\+$/, ''));
}

function collectProductionLicenses() {
  let raw;
  try {
    raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // pnpm exits non-zero with this message when there are simply no production
    // dependencies to inspect — a clean pass for a greenfield workspace.
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/No licenses (in packages )?found/i.test(text)) {
      return {};
    }
    // Some pnpm versions still print valid JSON to stdout alongside a non-zero
    // exit; try to use it before giving up.
    if (err.stdout && err.stdout.trim().startsWith('{')) {
      raw = err.stdout;
    } else {
      throw err;
    }
  }

  const trimmed = (raw ?? '').trim();
  // pnpm may print this notice (instead of JSON) on a zero exit when there are
  // no production dependencies to inspect — a clean pass.
  if (!trimmed || /No licenses (in packages )?found/i.test(trimmed)) return {};
  return JSON.parse(trimmed);
}

function main() {
  const byLicense = collectProductionLicenses();

  // `pnpm licenses list --json` returns an object keyed by license string,
  // each value an array of { name, version, ... } package records.
  const violations = [];
  let inspected = 0;

  for (const [license, packages] of Object.entries(byLicense)) {
    for (const pkg of packages) {
      inspected += 1;
      const id = `${pkg.name}@${pkg.version}`;
      const effective = PACKAGE_OVERRIDES.has(id)
        ? null // explicitly accepted
        : license;
      if (effective !== null && !isAllowedExpression(license)) {
        violations.push({ id, license });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `\n✖ License compliance check failed: ${violations.length} production ` +
        `dependency/-ies use a non-allowlisted license.\n`,
    );
    for (const v of violations) {
      console.error(`  - ${v.id}: ${v.license}`);
    }
    console.error(
      '\nAllowed licenses: ' +
        [...ALLOWED].sort().join(', ') +
        '\nIf a flagged license is genuinely acceptable, add it to ALLOWED, or add a\n' +
        'justified per-package entry to PACKAGE_OVERRIDES in scripts/check-licenses.mjs.\n',
    );
    process.exit(1);
  }

  console.log(
    `✓ License compliance OK — ${inspected} production dependency/-ies, ` +
      'all under allowlisted OSI-compatible licenses.',
  );
}

main();
