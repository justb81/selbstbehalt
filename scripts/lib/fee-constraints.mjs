// SPDX-License-Identifier: Apache-2.0
//
// Turns the legal prose of the GOÄ/GOZ/GOT "Allgemeine Bestimmungen" and inline
// notes into the structured, machine-checkable constraints defined in
// docs/data-format.md §5. High precision over recall: a sentence is only turned
// into a constraint when it matches a known pattern; anything else is kept as a
// free-text note so nothing is silently dropped.

/** Collapse whitespace, drop soft hyphens / non-breaking spaces. */
export function clean(s) {
  return (s || '')
    .replace(/[\u00AD]/g, '') // soft hyphen
    .replace(/[\u00A0]/g, ' ') // non-breaking space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical billing number: trim, collapse inner spaces ("K 1" → "K1"), and
 *  strip leading zeros from numeric ziffern ("0010" → "10") so that the
 *  zero-padded GOZ numbers and any cross-references resolve to one form. This
 *  is the normalisation the parser applies on lookup (docs/data-format.md §4). */
export function normalizeZiffer(s) {
  const t = clean(s).replace(/\s+/g, '');
  return /^\d+[a-z]?$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
}

/** True for a plausible billing number ("1", "437", "1829a", "A", "K1"). */
export function isZiffer(s) {
  return /^(\d{1,4}[a-z]?|[A-K]\d?)$/.test(normalizeZiffer(s));
}

/**
 * Expand a number list/range string into individual ziffern.
 * Handles "30, 34, 801", "271 bis 276", "861 bis 864", "1829 und 1829a".
 * Ranges wider than `maxRange` are kept as their two endpoints only (guards
 * against accidental blow-ups from non-range "bis" usages).
 */
export function parseNumbers(str, maxRange = 400) {
  const out = [];
  const re = /(\d+)\s*(?:bis|–|-)\s*(\d+)|(\d{1,4}[a-z]?)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] && m[2]) {
      const a = +m[1];
      const b = +m[2];
      if (b >= a && b - a <= maxRange) {
        for (let k = a; k <= b; k++) out.push(String(k));
      } else {
        out.push(m[1], m[2]);
      }
    } else if (m[3]) {
      out.push(m[3]);
    }
  }
  // Canonicalise (strip leading zeros) so refs match the entry keys.
  return [...new Set(out.map((z) => z.replace(/^0+(?=\d)/, '')))];
}

// A run of billing numbers with the connectors the law uses between them
// ("30, 34", "271 bis 276", "861 bis 864", "1 und/oder 5"). Built so the match
// is greedy over number tokens only and stops at the first non-number word.
const NUMLIST = String.raw`\d{1,4}[a-z]?(?:\s*(?:bis|und\/oder|und|oder|sowie|,)\s*\d{1,4}[a-z]?)*`;

// Subject of a rule: "Die Leistung(en) nach (den) Nummer(n) X …".
const SUBJECT_RE = new RegExp(
  String.raw`^\s*Die Leistungen? nach (?:der |den )?Nummern?\s+(${NUMLIST})\s+(?:ist|sind|darf|dürfen|kann|können|wird|werden)`,
  'i',
);
// Objects of an exclusion: "neben (den Leistungen nach) (den) Nummern O …".
const NEBEN_RE = new RegExp(
  String.raw`neben (?:den )?(?:Leistungen nach )?(?:der |den )?Nummern?\s+(${NUMLIST})`,
  'i',
);
// "ist Bestandteil der Leistung(en) nach (den) Nummern O".
const BESTANDTEIL_RE = new RegExp(
  String.raw`Bestandteil (?:der Leistungen? )?(?:nach (?:der |den )?Nummern? )(${NUMLIST})`,
  'i',
);
// "Höchstwert … (für|bei) … Nummer(n) O".
const HOECHSTWERT_RE = new RegExp(String.raw`Höchstwert\b[^.]*?Nummern?\s+(${NUMLIST})`, 'i');

function leadingSubjects(sentence) {
  const m = sentence.match(SUBJECT_RE);
  return m ? parseNumbers(m[1]) : [];
}

function frequencyScope(s) {
  if (/im Behandlungsfall/i.test(s)) return 'case';
  if (/je Behandlungstag|an demselben Tag|je Kalendertag|je Tag\b|am Tag\b/i.test(s)) return 'day';
  if (/je Sitzung/i.test(s)) return 'session';
  if (/je Inanspruchnahme|je Sitzung|je Besuch/i.test(s)) return 'occasion';
  return null;
}

function frequencyCount(s) {
  const hoechstens = s.match(/höchstens\s+(\d+)\s*mal/i);
  if (hoechstens) return +hoechstens[1];
  if (/\bdreimal\b/i.test(s)) return 3;
  if (/\bzweimal\b/i.test(s)) return 2;
  if (/\beinmal\b|\bnur einmal\b/i.test(s)) return 1;
  return null;
}

/**
 * Parse one rule sentence (an "Allgemeine Bestimmung" item or inline note).
 *
 * Returns `{ subjects, perSubject, groups, matched }`:
 *  - `subjects`   ziffern the rule is about (may be empty),
 *  - `perSubject` constraints to attach to *each* subject ziffer,
 *  - `groups`     schedule-level {@link ConstraintGroup}s,
 *  - `matched`    whether any pattern fired (else the caller keeps it as a note).
 */
export function parseRule(rawSentence) {
  const sentence = clean(rawSentence);
  const sourceText = sentence;
  const subjects = leadingSubjects(sentence);
  const perSubject = [];
  const groups = [];

  // Mutual exclusion: "… sind nicht nebeneinander berechnungsfähig."
  if (/nicht nebeneinander berechnungsfähig/i.test(sentence)) {
    const members = subjects.length ? subjects : parseNumbers(sentence);
    if (members.length >= 2) groups.push({ type: 'mutualExclusion', members, sourceText });
  }

  // Directional exclusion: "… ist neben den Nummern O … nicht berechnungsfähig."
  const neben = sentence.match(NEBEN_RE);
  if (neben && !/nebeneinander/i.test(sentence)) {
    const objects = parseNumbers(neben[1]);
    if (objects.length) perSubject.push({ type: 'excludes', ziffern: objects, sourceText });
  }

  // Component-of: "… ist Bestandteil der Leistungen nach den Nummern O …".
  const best = sentence.match(BESTANDTEIL_RE);
  if (best && subjects.length) {
    const objects = parseNumbers(best[1]);
    if (objects.length) perSubject.push({ type: 'componentOf', ziffern: objects, sourceText });
  }

  // Frequency: "… im Behandlungsfall nur einmal berechnungsfähig." etc.
  const scope = frequencyScope(sentence);
  const count = frequencyCount(sentence);
  if (scope && count && /berechnungsfähig|berechnet werden/i.test(sentence)) {
    perSubject.push({ type: 'maxFrequency', count, scope, sourceText });
  }

  // Minimum duration: "… mindestens 20 Minuten …".
  const dur = sentence.match(/(?:mindestens|Mindestdauer[^0-9]*)\s*(\d+)\s*Minuten/i);
  if (dur) perSubject.push({ type: 'minDuration', minutes: +dur[1], sourceText });

  // Age limit: "… bei Kindern bis zum vollendeten 4. Lebensjahr".
  const ageMax = sentence.match(/bis zum vollendeten\s+(\d+)\.\s*Lebensjahr/i);
  if (ageMax) perSubject.push({ type: 'ageLimit', maxAgeYears: +ageMax[1], sourceText });

  // Fixed factor: "… nur mit dem einfachen Gebührensatz berechnungsfähig".
  if (/nur mit dem einfachen Gebührensatz/i.test(sentence)) {
    perSubject.push({ type: 'fixedFactor', factor: 1.0, sourceText });
  }

  const matched = perSubject.length > 0 || groups.length > 0;
  return { subjects, perSubject, groups, matched };
}

/** Höchstwert note → a maxAmount group (amount filled in by the caller). */
export function parseHoechstwert(rawSentence) {
  const sentence = clean(rawSentence);
  if (!/Höchstwert/i.test(sentence)) return null;
  const m = sentence.match(HOECHSTWERT_RE);
  const members = m ? parseNumbers(m[1]) : [];
  if (!members.length) return null;
  return {
    type: 'maxAmount',
    members,
    scope: frequencyScope(sentence) || undefined,
    sourceText: sentence,
  };
}

/** A "Zuschlag zu …" description → the base numbers it requires (or []). */
export function parseZuschlagRequires(description) {
  const d = clean(description);
  if (!/^Zuschlag\b/i.test(d)) return [];
  const m = d.match(
    new RegExp(
      String.raw`zu (?:den )?(?:Leistungen|Untersuchungen|der Leistung|der Visite)?\s*nach (?:der |den )?Nummern?\s+(${NUMLIST})`,
      'i',
    ),
  );
  return m ? parseNumbers(m[1]) : [];
}
