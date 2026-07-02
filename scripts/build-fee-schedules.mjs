// SPDX-License-Identifier: Apache-2.0
//
// Generates the static fee-schedule lookup tables (packages/medic-invoice-check/src/lib/data/
// {goae,goz,got}.json) from the official gesetze-im-internet.de XML exports
// under data/input/. Reproducible and dependency-free (see scripts/check-
// licenses.mjs for the same convention). The output format is defined in
// docs/data-format.md / packages/medic-invoice-check/src/lib/data/fee-schedule.ts and enforced by
// scripts/validate-fee-schedules.mjs.
//
// Maintainer workflow (see docs/data-format.md §7): update the source XML under
// data/input/, run `pnpm fees:build`, run `pnpm fees:validate`, review the diff.
//
// Run: node scripts/build-fee-schedules.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseXml, findAll, findFirst, isElement, text } from './lib/mini-xml.mjs';
import {
  clean,
  normalizeZiffer,
  isZiffer,
  parseRule,
  parseHoechstwert,
  parseZuschlagRequires,
} from './lib/fee-constraints.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packages', 'medic-invoice-check', 'src', 'lib', 'data');

const GOAE_LIMITS = {
  default: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
  technical: { regelhoechstsatz: 1.8, hoechstsatz: 2.5 },
  lab: { regelhoechstsatz: 1.15, hoechstsatz: 1.3 },
  inpatient: { regelhoechstsatz: 1.8, hoechstsatz: 2.5 },
};
// GOZ §5 applies one Gebührenrahmen (1.0–3.5, Schwellenwert 2.3) to every
// number — no Teil-M-style reduced categories. GOT §5 allows the 1.0–3.0fach
// range with no Regelhöchstsatz; flag against the 3.0 ceiling.
const GOZ_LIMITS = {
  default: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
  technical: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
  lab: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
  inpatient: { regelhoechstsatz: 2.3, hoechstsatz: 3.5 },
};
const GOT_LIMITS = {
  default: { regelhoechstsatz: null, hoechstsatz: 3.0 },
  technical: { regelhoechstsatz: null, hoechstsatz: 3.0 },
  lab: { regelhoechstsatz: null, hoechstsatz: 3.0 },
  inpatient: { regelhoechstsatz: null, hoechstsatz: 3.0 },
};

// Errata for typos in the official source XML. These cannot be fixed at the
// source — scripts/fetch-sources.mjs re-downloads it monthly — so the
// correction lives in the build. Each rule renumbers a single mis-printed row,
// matched on its source Ziffer plus a description test so only that one row is
// touched. The build warns if a rule stops matching (source fixed upstream →
// remove it). See docs/data-format.md §7.
const SOURCE_ERRATA = {
  GOÄ: [
    {
      // The official XML prints "Lithium" as 4114, but 4114 is the
      // Renin-Aldosteron-Suppressionstest; Lithium is 4214 (it follows
      // 4210–4213 in Abschnitt M). Without this, the two 4114 rows collide and
      // last-write-wins silently drops the real 4114.
      from: '4114',
      whenDescription: /^Lithium$/i,
      to: '4214',
    },
  ],
};

const SCHEDULES = [
  {
    feeSchedule: 'GOÄ',
    version: '1996-neugefasst',
    dir: 'data/input/goae',
    out: 'goae.json',
    pointValueCents: 5.82873,
    multiplierLimits: GOAE_LIMITS,
    law: 'GOÄ 1982 (neugefasst 1996)',
    norm: (root) => normNamed(root, 'Anlage'),
    category: goaeCategory,
    sectionOf: goaeSection,
    benefitCategory: () => 'ambulant',
  },
  {
    feeSchedule: 'GOZ',
    version: '1987',
    dir: 'data/input/goz',
    out: 'goz.json',
    pointValueCents: 5.62421,
    multiplierLimits: GOZ_LIMITS,
    law: 'GOZ (Gebührenordnung für Zahnärzte, 1987)',
    norm: (root) => normNamed(root, 'Anlage 1'),
    category: () => 'default',
    sectionOf: gozSection,
    benefitCategory: gozBenefitCategory,
  },
  {
    feeSchedule: 'GOT',
    version: '2022',
    dir: 'data/input/got',
    out: 'got.json',
    pointValueCents: null,
    multiplierLimits: GOT_LIMITS,
    law: 'GOT (Gebührenordnung für Tierärzte, 2022)',
    norm: null, // GOT: process the largest fee table directly
    category: () => 'default',
    benefitCategory: () => 'sonstiges', // veterinary — outside the human PKV benefit areas
  },
];

// GOÄ Abschnitte A–O with their numeric ranges (from the Gebührenverzeichnis
// Übersicht). Used for deterministic section metadata; category is derived
// separately by §5 below.
const GOAE_SECTIONS = [
  ['B', 1, 109, 'Grundleistungen und allgemeine Leistungen'],
  ['C', 200, 449, 'Nichtgebietsbezogene Sonderleistungen'],
  ['D', 450, 498, 'Anästhesieleistungen'],
  ['E', 500, 569, 'Physikalisch-medizinische Leistungen'],
  ['F', 600, 793, 'Innere Medizin, Kinderheilkunde, Dermatologie'],
  ['G', 800, 887, 'Neurologie, Psychiatrie und Psychotherapie'],
  ['H', 1001, 1168, 'Geburtshilfe und Gynäkologie'],
  ['I', 1200, 1386, 'Augenheilkunde'],
  ['J', 1400, 1639, 'Hals-, Nasen-, Ohrenheilkunde'],
  ['K', 1700, 1860, 'Urologie'],
  ['L', 2000, 3321, 'Chirurgie, Orthopädie'],
  ['M', 3500, 4787, 'Laboratoriumsuntersuchungen'],
  ['N', 4800, 4873, 'Histologie, Zytologie und Zytogenetik'],
  [
    'O',
    5000,
    5855,
    'Strahlendiagnostik, Nuklearmedizin, Magnetresonanztomographie und Strahlentherapie',
  ],
];

function goaeSection(ziffer) {
  const n = parseInt(ziffer, 10);
  if (!Number.isFinite(n)) return undefined;
  for (const [code, lo, hi, title] of GOAE_SECTIONS) if (n >= lo && n <= hi) return { code, title };
  return undefined;
}

function goaeCategory(ziffer) {
  const n = parseInt(ziffer, 10);
  if (!Number.isFinite(n)) return 'default'; // letter-coded surcharges (Abschnitt A/B)
  if (n === 437 || (n >= 3500 && n <= 4787)) return 'lab'; // §5(4): Nr. 437 + Abschnitt M
  if ((n >= 500 && n <= 569) || (n >= 5000 && n <= 5855)) return 'technical'; // §5(3): Abschnitte E, O
  return 'default';
}

// GOZ Abschnitte A–J with their numeric ranges (Gebührenverzeichnis für
// zahnärztliche Leistungen). Used for both section metadata and the
// `benefitCategory` mapping onto a tariff's `included_benefits` areas (§3.2):
// prosthetics (F) and implantology (J) are Zahnersatz, orthodontics (G) is
// Kieferorthopädie, everything else is Zahnbehandlung.
const GOZ_SECTIONS = [
  ['A', 1, 999, 'Allgemeine zahnärztliche Leistungen', 'zahnbehandlung'],
  ['B', 1000, 1999, 'Prophylaktische Leistungen', 'zahnbehandlung'],
  ['C', 2000, 2999, 'Konservierende Leistungen', 'zahnbehandlung'],
  ['D', 3000, 3999, 'Chirurgische Leistungen', 'zahnbehandlung'],
  [
    'E',
    4000,
    4999,
    'Leistungen bei Erkrankungen der Mundschleimhaut und des Parodontiums',
    'zahnbehandlung',
  ],
  ['F', 5000, 5999, 'Prothetische Leistungen', 'zahnersatz'],
  ['G', 6000, 6999, 'Kieferorthopädische Leistungen', 'kieferorthopaedie'],
  ['H', 7000, 7999, 'Eingliederung von Aufbissbehelfen und Schienen', 'zahnbehandlung'],
  [
    'I',
    8000,
    8999,
    'Funktionsanalytische und funktionstherapeutische Leistungen',
    'zahnbehandlung',
  ],
  ['J', 9000, 9999, 'Implantologische Leistungen', 'zahnersatz'],
];

function gozSectionTuple(ziffer) {
  const n = parseInt(ziffer, 10);
  if (!Number.isFinite(n)) return undefined;
  return GOZ_SECTIONS.find(([, lo, hi]) => n >= lo && n <= hi);
}

function gozSection(ziffer) {
  const t = gozSectionTuple(ziffer);
  return t ? { code: t[0], title: t[3] } : undefined;
}

function gozBenefitCategory(ziffer) {
  const t = gozSectionTuple(ziffer);
  return t ? t[4] : 'zahnbehandlung';
}

function normNamed(root, enbez) {
  for (const norm of findAll(root, 'norm')) {
    const e = findFirst(norm, 'enbez');
    if (e && clean(text(e)) === enbez) return norm;
  }
  throw new Error(`norm <enbez>${enbez}</enbez> not found`);
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function parseEuro(s) {
  const t = clean(s).replace(/\./g, '').replace(',', '.');
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

/** Direct <entry> cells of a row, as cleaned text (nested-table text included). */
function cells(row) {
  return (row.children || [])
    .filter((c) => isElement(c) && c.name === 'entry')
    .map((e) => clean(text(e)));
}

/** Rows belonging directly to a table — never rows of a table nested in a cell. */
function directRows(table) {
  const rows = [];
  (function rec(node) {
    for (const c of node.children || []) {
      if (!isElement(c)) continue;
      if (c.name === 'table') continue; // skip nested tables entirely
      if (c.name === 'row') {
        rows.push(c);
        continue;
      }
      rec(c);
    }
  })(table);
  return rows;
}

// ---------------------------------------------------------------------------
// A single accumulator shared by all schedules: entries plus deferred
// constraints (which may reference numbers defined later in the same section).
// ---------------------------------------------------------------------------
function makeBuilder(schedule) {
  const entries = {};
  const order = [];
  const perZiffer = new Map(); // ziffer → Constraint[]
  const notesByZiffer = new Map(); // ziffer → string[]
  const groups = [];
  let lastZiffer = null;
  const errata = SOURCE_ERRATA[schedule.feeSchedule] || [];
  const stats = {
    entries: 0,
    constraints: 0,
    groups: 0,
    notes: 0,
    unmatchedNotes: 0,
    errataApplied: {},
  };

  function addConstraint(ziffer, c) {
    if (!perZiffer.has(ziffer)) perZiffer.set(ziffer, []);
    perZiffer.get(ziffer).push(c);
    stats.constraints++;
  }
  function addNote(ziffer, note) {
    if (!ziffer) return;
    if (!notesByZiffer.has(ziffer)) notesByZiffer.set(ziffer, []);
    notesByZiffer.get(ziffer).push(note);
    stats.notes++;
  }

  function baseAmount(points, euro) {
    if (schedule.pointValueCents == null) return euro;
    return round2((points * schedule.pointValueCents) / 100);
  }

  function addEntry({ ziffer, description, points, euro, section }) {
    const desc = clean(description);
    let z = normalizeZiffer(ziffer);
    for (const e of errata) {
      if (z === e.from && e.whenDescription.test(desc)) {
        z = normalizeZiffer(e.to);
        const key = `${e.from}→${e.to}`;
        stats.errataApplied[key] = (stats.errataApplied[key] || 0) + 1;
        break;
      }
    }
    const category = schedule.category(z);
    const lim = schedule.multiplierLimits[category];
    const entry = {
      ziffer: z,
      description: desc,
      points: points ?? null,
      baseAmount: baseAmount(points, euro),
      category,
      benefitCategory: schedule.benefitCategory(z),
      maxMultiplier: lim.regelhoechstsatz ?? lim.hoechstsatz,
    };
    if (/^Zuschlag\b/i.test(desc)) {
      entry.isSurcharge = true;
      const req = parseZuschlagRequires(desc);
      if (req.length) addConstraint(z, { type: 'requires', anyOf: req, sourceText: desc });
    }
    const finalSection = schedule.sectionOf ? schedule.sectionOf(z) : section;
    if (finalSection) entry.section = finalSection;
    if (entries[z]) (stats.duplicates ||= []).push(z);
    entries[z] = entry;
    order.push(z);
    lastZiffer = z;
    stats.entries++;
    return entry;
  }

  // Apply a free-prose rule sentence: attach to its subjects, or (subject-less
  // inline note) to the preceding entry; keep unmatched prose as a note.
  function applyRule(sentence, { fallbackZiffer } = {}) {
    const text = clean(sentence);
    if (text.length < 6) return;
    const hw = parseHoechstwert(text);
    if (hw) {
      groups.push({ id: `hoechstwert-${hw.members.join('-').slice(0, 40)}`, ...hw });
      stats.groups++;
      return;
    }
    const { subjects, perSubject, groups: g, matched } = parseRule(text);
    for (const grp of g) {
      groups.push({ id: `excl-${grp.members.join('-').slice(0, 40)}`, ...grp });
      stats.groups++;
    }
    const targets = subjects.length ? subjects : fallbackZiffer ? [fallbackZiffer] : [];
    for (const z of targets) for (const c of perSubject) addConstraint(z, c);
    if (!matched) {
      // Keep as a note on its subjects / the preceding entry so nothing is lost.
      const noteTargets = subjects.length ? subjects : fallbackZiffer ? [fallbackZiffer] : [];
      for (const z of noteTargets) addNote(z, text);
      if (!noteTargets.length) stats.unmatchedNotes++;
    }
  }

  function addGroupHoechstwert(sentence, amount) {
    const hw = parseHoechstwert(sentence);
    if (!hw) return;
    if (amount != null) hw.amount = amount;
    groups.push({ id: `hoechstwert-${hw.members.join('-').slice(0, 40)}`, ...hw });
    stats.groups++;
  }

  function finalize() {
    for (const z of order) {
      const cs = perZiffer.get(z);
      if (cs && cs.length) entries[z].constraints = cs;
      const ns = notesByZiffer.get(z);
      if (ns && ns.length) entries[z].notes = ns;
    }
    // Drop constraints/groups referencing unknown ziffern (logged by validator).
    return { entries, groups, stats, lastZiffer: () => lastZiffer };
  }

  return {
    addEntry,
    applyRule,
    addGroupHoechstwert,
    addNote,
    finalize,
    getLast: () => lastZiffer,
  };
}

// ---------------------------------------------------------------------------
// GOÄ / GOZ: a document-order flow of <P> (headings + Allgemeine Bestimmungen)
// and <table> (fee rows). GOZ additionally carries inline notes as <I> inside
// the description cell.
// ---------------------------------------------------------------------------
function buildPointSchedule(schedule, root) {
  const b = makeBuilder(schedule);
  const norm = schedule.norm(root);
  const section = { code: null, title: null };

  // The fee tables are wrapped inside <P> elements, so a <P> may carry a
  // heading, an Allgemeine-Bestimmungen <DL>, or a <table> (or just be a
  // container). Process its own heading/AB, then let the walker recurse into it
  // to reach any nested table.
  function processP(p) {
    if (findFirst(p, 'table')) return; // table-wrapping P: nothing of its own
    const bold = (p.children || []).find((c) => isElement(c) && c.name === 'B');
    if (bold) {
      const t = clean(text(bold));
      const sec = t.match(/^([A-Z])\.\s+(.+)$/);
      if (sec) {
        section.code = sec[1];
        section.title = sec[2];
      }
      return; // subsection (roman) headings keep the current section code
    }
    if (/Allgemeine Bestimmungen/i.test(text(p))) {
      for (const dd of findAll(p, 'DD')) b.applyRule(text(dd));
    }
  }

  function descriptionAndNotes(col2) {
    // Description = text before the first <I>; each <I> is a Bestimmung note.
    let desc = '';
    const notes = [];
    let hitItalic = false;
    for (const c of col2.children || []) {
      if (isElement(c) && c.name === 'I') {
        hitItalic = true;
        notes.push(clean(text(c)));
      } else if (!hitItalic) {
        desc += text(c);
      }
    }
    return { description: clean(desc), notes };
  }

  const NUM = /^\d{1,4}[a-z]?$/; // numeric Ziffer (incl. "1829a"); letter-coded Zuschläge are skipped

  function processTable(table) {
    const thead = findFirst(table, 'thead');
    if (thead && /Seite|Übersicht/i.test(text(thead))) return; // TOC table
    // Abschnitt-M "Katalog" runs: a method-header row states the Punktzahl that
    // the numbered analytes listed under it share (those analyte rows print an
    // empty fee column). Track the run's rate and the last header's points so the
    // analytes are emitted as real, priced entries instead of dropped as notes.
    let catalogRate = null;
    let lastHeaderPoints = null;
    for (const row of directRows(table)) {
      const cs = cells(row);
      if (!cs.length || cs.every((c) => c === '')) continue;
      const entryEls = (row.children || []).filter((c) => isElement(c) && c.name === 'entry');
      // The Ziffer sits in column 0 (4-col tables) or column 1 (5-col tables
      // with a leading indent column). Restricting to those columns keeps cap
      // rows ("Höchstwert … 97 …") from being mistaken for entries.
      let zi = -1;
      if (NUM.test(cs[0])) zi = 0;
      else if (cs[0] === '' && NUM.test(cs[1] || '')) zi = 1;
      const pointsCell = zi >= 0 ? cs.slice(zi + 1).find((c) => /^\d+$/.test(c)) : undefined;

      // A numbered row is a billing number whether or not it prints a fee. Rows
      // with their own Punktzahl are priced from it and end any Katalog run.
      // Fee-less numbered rows are either Katalog analytes (priced at the shared
      // header rate) or derived-fee positions — percentage Zuschläge and GOZ
      // Teilleistungen — which carry no fixed amount (points: null, baseAmount 0).
      // All of these were previously dropped and mis-parsed as note rows.
      if (zi >= 0) {
        let points;
        if (pointsCell !== undefined) {
          points = +pointsCell;
          catalogRate = null;
        } else {
          points = catalogRate; // null outside a Katalog → derived-fee entry
        }
        const descEl = entryEls[zi + 1];
        let description = descEl ? clean(text(descEl)) : '';
        const sec = section.code ? { code: section.code, title: section.title } : undefined;
        if (schedule.feeSchedule === 'GOZ' && descEl) {
          const dn = descriptionAndNotes(descEl);
          description = dn.description || description;
          const entry = b.addEntry({ ziffer: cs[zi], description, points, section: sec });
          for (const note of dn.notes) b.applyRule(note, { fallbackZiffer: entry.ziffer });
        } else {
          b.addEntry({ ziffer: cs[zi], description, points, section: sec });
        }
        continue;
      }

      // Otherwise: a note / Bestimmung / Höchstwert / Katalog row. Use the longest cell.
      const noteText = cs.reduce((a, c) => (c.length > a.length ? c : a), '');
      // A "Katalog" marker opens a run of analytes billed at the point value of
      // the method-header row right above it; carry that rate to those analytes.
      if (clean(noteText) === 'Katalog') {
        catalogRate = lastHeaderPoints;
        continue;
      }
      // Remember this row's own Punktzahl (if any) so the next "Katalog" can use
      // it; a header without one leaves the following analytes unpriced (null).
      const headerPoints = cs.find((c) => /^\d+$/.test(c));
      lastHeaderPoints = headerPoints !== undefined ? +headerPoints : null;
      if (noteText.length < 6) continue;
      if (/Höchstwert/i.test(noteText)) {
        const capPoints = cs.find((c) => /^\d+$/.test(c));
        const amount =
          capPoints && schedule.pointValueCents != null
            ? round2((+capPoints * schedule.pointValueCents) / 100)
            : undefined;
        b.addGroupHoechstwert(noteText, amount);
      } else {
        b.applyRule(noteText, { fallbackZiffer: b.getLast() });
      }
    }
  }

  (function walk(node) {
    for (const c of node.children || []) {
      if (!isElement(c)) continue;
      if (c.name === 'table') {
        processTable(c); // consumes the whole table; do not recurse into it
      } else if (c.name === 'P') {
        processP(c);
        walk(c); // recurse: fee tables are nested inside <P>
      } else {
        walk(c);
      }
    }
  })(norm);

  return b.finalize();
}

// ---------------------------------------------------------------------------
// GOT: one large table; rows are either bold section headings (Teil A/B/C and
// sub-groups) or [Nr, Leistung, Euro] entries. Euro amounts are listed directly.
// ---------------------------------------------------------------------------
function buildGot(schedule, root) {
  const b = makeBuilder(schedule);
  const tables = findAll(root, 'table');
  const verzeichnis = tables.reduce((a, t) =>
    directRows(t).length > directRows(a).length ? t : a,
  );
  const section = { code: null, title: null };

  for (const row of directRows(verzeichnis)) {
    const cs = cells(row);
    if (!cs.length || cs.every((c) => c === '')) continue;
    const bold = findFirst(row, 'B');
    if (bold) {
      const t = clean(text(bold));
      const teil = t.match(/^Teil\s+([A-Z])/);
      if (teil) {
        section.code = teil[1];
        section.title = t.replace(/^Teil\s+[A-Z]\s*/, '') || null;
      } else {
        section.title = t;
      }
      continue;
    }
    const z = cs[0];
    const euro = cs.slice(1).find((c) => /\d,\d{2}/.test(c));
    if (isZiffer(z) && euro !== undefined) {
      const entry = b.addEntry({
        ziffer: z,
        description: cs[1] || '',
        points: null,
        euro: parseEuro(euro),
        section: section.code ? { code: section.code, title: section.title } : undefined,
      });
      void entry;
    } else if (cs.length === 1 && cs[0].length > 30) {
      // Single-cell prose row → an Allgemeine-Bestimmung-style note.
      b.applyRule(cs[0], { fallbackZiffer: b.getLast() });
    }
  }
  return b.finalize();
}

function dropDangling(result) {
  const have = new Set(Object.keys(result.entries));
  let dropped = 0;
  for (const e of Object.values(result.entries)) {
    if (e.constraints) {
      for (const c of e.constraints) {
        if (c.ziffern) {
          const keep = c.ziffern.filter((z) => have.has(z));
          dropped += c.ziffern.length - keep.length;
          c.ziffern = keep;
        }
        if (c.anyOf) {
          const keep = c.anyOf.filter((z) => have.has(z));
          dropped += c.anyOf.length - keep.length;
          c.anyOf = keep;
        }
      }
      e.constraints = e.constraints
        .filter((c) => !c.ziffern || c.ziffern.length)
        .filter((c) => !c.anyOf || c.anyOf.length);
      if (!e.constraints.length) delete e.constraints;
    }
  }
  result.groups = result.groups
    .map((g) => {
      const keep = g.members.filter((z) => have.has(z));
      dropped += g.members.length - keep.length;
      return { ...g, members: keep };
    })
    .filter((g) => g.members.length >= (g.type === 'mutualExclusion' ? 2 : 1));
  result.stats.droppedRefs = dropped;
  return result;
}

// Resolve the single legal-text XML inside a source directory. Globbing by
// directory (rather than a hard-coded BJNR filename) keeps the build working
// when an updated consolidation changes the file name (e.g. the monthly
// refresh in .github/workflows/update-fee-sources.yml).
function resolveSourceFile(dir) {
  const xmls = readdirSync(join(ROOT, dir)).filter((f) => f.toLowerCase().endsWith('.xml'));
  if (xmls.length !== 1)
    throw new Error(`expected exactly one .xml in ${dir}, found ${xmls.length}`);
  return `${dir}/${xmls[0]}`;
}

function build(schedule) {
  const file = resolveSourceFile(schedule.dir);
  const xml = readFileSync(join(ROOT, file), 'utf8');
  const root = parseXml(xml);
  const doc = findFirst(root, 'dokumente') || root;
  const buildDate = findFirst(root, 'norm')?.attrs?.builddate || doc.attrs?.builddate || 'unknown';
  // "Stand" line from the lead norm metadata.
  let lawStatus = 'unknown';
  for (const sk of findAll(root, 'standkommentar')) {
    const t = clean(text(sk));
    if (/geändert|Neugefasst|Stand/i.test(t)) lawStatus = t;
  }

  const result =
    schedule.feeSchedule === 'GOT' ? buildGot(schedule, root) : buildPointSchedule(schedule, root);
  dropDangling(result);

  const table = {
    schema: 'fee-schedule/v1',
    feeSchedule: schedule.feeSchedule,
    version: schedule.version,
    source: {
      law: schedule.law,
      file,
      doknr: doc.attrs?.doknr || 'unknown',
      lawStatus,
      buildDate,
    },
    pointValueCents: schedule.pointValueCents,
    currency: 'EUR',
    multiplierLimits: schedule.multiplierLimits,
    entries: result.entries,
    constraintGroups: result.groups,
  };

  const outPath = join(OUT_DIR, schedule.out);
  writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n', 'utf8');
  const s = result.stats;

  // Report applied source errata; warn if a rule matched nothing (the source
  // was likely fixed upstream and the rule can be removed).
  const errataMsgs = [];
  for (const e of SOURCE_ERRATA[schedule.feeSchedule] || []) {
    const key = `${e.from}→${e.to}`;
    const n = s.errataApplied[key] || 0;
    if (n === 0)
      console.warn(
        `  ⚠ ${schedule.feeSchedule}: erratum ${key} matched no row — source may be fixed upstream; remove it from SOURCE_ERRATA.`,
      );
    else errataMsgs.push(`${key}×${n}`);
  }
  const errata = errataMsgs.length ? ` [errata: ${errataMsgs.join(', ')}]` : '';

  // Any remaining duplicate is unexpected: last-write-wins silently drops the
  // earlier entry, so fail the build and force a human to add an erratum.
  if (s.duplicates) {
    console.error(
      `  ✗ ${schedule.feeSchedule}: ${s.duplicates.length} unexpected duplicate ziffern: ${[...new Set(s.duplicates)].join(',')} — add a SOURCE_ERRATA rule.`,
    );
    process.exitCode = 1;
  }

  console.log(
    `${schedule.feeSchedule}: ${Object.keys(result.entries).length} entries, ${s.constraints} constraints, ` +
      `${s.groups} groups, ${s.notes} notes (dropped ${s.droppedRefs} dangling refs) → ${schedule.out}${errata}`,
  );
  return table;
}

for (const schedule of SCHEDULES) build(schedule);
