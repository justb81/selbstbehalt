// SPDX-License-Identifier: Apache-2.0
//
// CI gate for the generated fee-schedule tables (apps/frontend/src/lib/data/
// {goae,goz,got}.json). Enforces the format from docs/data-format.md §6:
// schema shape, Ziffer uniqueness, referential integrity, price plausibility,
// §5 category/limit consistency, and the symmetric-exclusion contract.
//
// Dependency-free on purpose (see scripts/check-licenses.mjs). The JSON Schema
// in data/schema/fee-schedule.schema.json is the canonical contract; the checks
// here mirror its invariants and add the domain-specific ones a generic schema
// cannot express.
//
// Run: node scripts/validate-fee-schedules.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['goae.json', 'goz.json', 'got.json'].map((f) =>
  join(ROOT, 'apps', 'frontend', 'src', 'lib', 'data', f),
);
const CATEGORIES = ['default', 'technical', 'lab', 'inpatient'];
const BENEFIT_CATEGORIES = [
  'ambulant',
  'stationaer',
  'zahnbehandlung',
  'zahnersatz',
  'kieferorthopaedie',
  'heilmittel',
  'hilfsmittel',
  'wahlleistung',
  'sonstiges',
];
const CONSTRAINT_TYPES = [
  'excludes',
  'requires',
  'componentOf',
  'maxFrequency',
  'minDuration',
  'ageLimit',
  'fixedFactor',
];

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function validate(path) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  let table;
  try {
    table = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { errors: [`cannot read/parse: ${e.message}`], warnings: [] };
  }

  // --- top-level shape ---
  if (table.schema !== 'fee-schedule/v1')
    err(`schema must be "fee-schedule/v1", got ${table.schema}`);
  if (!['GOÄ', 'GOZ', 'GOT'].includes(table.feeSchedule))
    err(`bad feeSchedule ${table.feeSchedule}`);
  if (table.currency !== 'EUR') err(`currency must be EUR`);
  if (!table.source || !table.source.file?.startsWith('data/input/'))
    err(`source.file must point under data/input/`);
  if (table.pointValueCents != null && !(table.pointValueCents > 0))
    err(`pointValueCents must be > 0 or null`);
  for (const cat of CATEGORIES) {
    const lim = table.multiplierLimits?.[cat];
    if (!lim) err(`multiplierLimits.${cat} missing`);
    else
      for (const k of ['regelhoechstsatz', 'hoechstsatz'])
        if (lim[k] != null && !(lim[k] > 0))
          err(`multiplierLimits.${cat}.${k} must be > 0 or null`);
  }
  if (!table.entries || typeof table.entries !== 'object' || !Object.keys(table.entries).length)
    err(`entries must be a non-empty object`);
  if (!Array.isArray(table.constraintGroups)) err(`constraintGroups must be an array`);

  const ids = new Set(Object.keys(table.entries || {}));
  const has = (z) => ids.has(z);

  // --- entries ---
  for (const [key, e] of Object.entries(table.entries || {})) {
    const where = `entry ${key}`;
    if (e.ziffer !== key) err(`${where}: key !== ziffer ("${e.ziffer}")`);
    if (!e.description) err(`${where}: empty description`);
    if (!(e.baseAmount >= 0)) err(`${where}: baseAmount must be >= 0`);
    if (!CATEGORIES.includes(e.category)) err(`${where}: bad category ${e.category}`);
    if (!BENEFIT_CATEGORIES.includes(e.benefitCategory))
      err(`${where}: bad benefitCategory ${e.benefitCategory}`);
    // benefitCategory must match the schedule's domain (catches a GOZ range regression).
    const allowedBenefits = {
      GOÄ: ['ambulant'],
      GOZ: ['zahnbehandlung', 'zahnersatz', 'kieferorthopaedie'],
      GOT: ['sonstiges'],
    }[table.feeSchedule];
    if (allowedBenefits && !allowedBenefits.includes(e.benefitCategory))
      err(`${where}: benefitCategory ${e.benefitCategory} not valid for ${table.feeSchedule}`);
    if (!(e.maxMultiplier > 0)) err(`${where}: maxMultiplier must be > 0`);

    // §5 consistency: maxMultiplier == regelhoechstsatz (or hoechstsatz when there is no threshold).
    const lim = table.multiplierLimits?.[e.category];
    if (lim) {
      const expected = lim.regelhoechstsatz ?? lim.hoechstsatz;
      if (e.maxMultiplier !== expected)
        err(`${where}: maxMultiplier ${e.maxMultiplier} != ${expected} for category ${e.category}`);
    }

    // price plausibility
    if (table.pointValueCents == null) {
      if (e.points !== null) err(`${where}: GOT entry must have points=null`);
      if (!(e.baseAmount > 0)) warn(`${where}: baseAmount is 0`);
    } else if (e.points === null) {
      // Point-less GOÄ/GOZ entry: a percentage Zuschlag or a GOZ Teilleistung
      // whose fee is derived from a base position, so it carries no fixed amount.
      if (e.baseAmount !== 0) err(`${where}: point-less entry must have baseAmount 0`);
    } else {
      if (!(e.points >= 0)) err(`${where}: points must be >= 0`);
      const expected = round2((e.points * table.pointValueCents) / 100);
      if (Math.abs(expected - e.baseAmount) > 0.011)
        err(`${where}: baseAmount ${e.baseAmount} != points×pointValue (${expected})`);
    }

    // constraints
    for (const c of e.constraints || []) {
      if (!CONSTRAINT_TYPES.includes(c.type)) err(`${where}: unknown constraint type ${c.type}`);
      if (!c.sourceText) err(`${where}: constraint ${c.type} missing sourceText`);
      for (const ref of c.ziffern || [])
        if (!has(ref)) err(`${where}: ${c.type} references unknown ${ref}`);
      for (const ref of c.anyOf || [])
        if (!has(ref)) err(`${where}: requires references unknown ${ref}`);
      if (c.type === 'maxFrequency' && !(c.count >= 1 && c.scope))
        err(`${where}: bad maxFrequency`);
      if (c.type === 'requires' && !e.isSurcharge) warn(`${where}: requires without isSurcharge`);
    }
  }

  // --- constraintGroups ---
  for (const g of table.constraintGroups || []) {
    const where = `group ${g.id}`;
    if (!g.id) err(`group missing id`);
    if (!['mutualExclusion', 'maxAmount'].includes(g.type)) err(`${where}: bad type ${g.type}`);
    if (!g.sourceText) err(`${where}: missing sourceText`);
    for (const ref of g.members || []) if (!has(ref)) err(`${where}: references unknown ${ref}`);
    if (g.type === 'mutualExclusion' && (g.members || []).length < 2)
      err(`${where}: mutualExclusion needs >= 2 members`);
    if (g.type === 'maxAmount' && !(g.amount >= 0)) err(`${where}: maxAmount needs amount >= 0`);
  }

  // --- symmetric-exclusion contract (docs/data-format.md §5.2.1) ---
  // Build the incompatibility pair set from both forms and confirm detection is
  // order-independent: every excludes edge resolves the same whichever side it
  // is stored on.
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairs = new Set();
  for (const [key, e] of Object.entries(table.entries || {}))
    for (const c of e.constraints || [])
      if (c.type === 'excludes') for (const o of c.ziffern || []) pairs.add(pairKey(key, o));
  for (const g of table.constraintGroups || [])
    if (g.type === 'mutualExclusion')
      for (let i = 0; i < g.members.length; i++)
        for (let j = i + 1; j < g.members.length; j++)
          pairs.add(pairKey(g.members[i], g.members[j]));
  for (const p of pairs) {
    const [a, b] = p.split('|');
    if (!has(a) || !has(b)) err(`exclusion pair references unknown ziffer: ${p}`);
  }

  return { errors, warnings, table, pairs: pairs.size };
}

let failed = false;
for (const path of FILES) {
  const name = path.split('/').pop();
  const { errors, warnings, table, pairs } = validate(path);
  for (const w of warnings.slice(0, 5)) console.log(`  warn  ${name}: ${w}`);
  if (warnings.length > 5) console.log(`  warn  ${name}: … ${warnings.length - 5} more warnings`);
  if (errors.length) {
    failed = true;
    for (const e of errors.slice(0, 25)) console.error(`  ERROR ${name}: ${e}`);
    if (errors.length > 25) console.error(`  ERROR ${name}: … ${errors.length - 25} more errors`);
    console.error(`✗ ${name}: ${errors.length} error(s)`);
  } else {
    const n = Object.keys(table.entries).length;
    console.log(
      `✓ ${name}: ${n} entries, ${table.constraintGroups.length} groups, ${pairs} exclusion pairs OK`,
    );
  }
}
if (failed) {
  console.error('\nfee-schedule validation failed');
  process.exit(1);
}
console.log('\nall fee-schedule tables valid');
