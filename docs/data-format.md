# Gebührenordnungs-Datenformat (GOÄ / GOZ / GOT)

> **Zweck:** Definition des generischen, versionierten JSON-Formats für die
> Gebühren-Lookup-Tabellen, gegen die der Rechnungsparser (#16) jede Position
> prüft. Ergänzt `docs/design.md` §4.4 und ist die maßgebliche Spezifikation
> für Issue #15.
>
> **Status:** Format-Definition. Das Extraktionsskript (XML → JSON) und der
> CI-Validator sind die nächsten Teilaufgaben von #15; sie erzeugen bzw. prüfen
> Tabellen in genau diesem Format.

Kanonische Definitionen:

- **TypeScript-Typen:** `frontend/src/lib/data/fee-schedule.ts`
- **JSON-Schema (CI-Validierung):** `data/schema/fee-schedule.schema.json`
- **Annotiertes Beispiel (jeder Constraint-Typ mit echtem Gesetzeswortlaut):**
  `data/examples/fee-schedule.example.json`

## 1. Designziele

1. **Ein Format für alle drei Gebührenordnungen.** GOÄ, GOZ und GOT
   unterscheiden sich nur in Preisberechnung und Detailtiefe der Regeln, nicht
   in der Struktur. Der Parser lädt für jede Ordnung dieselbe Tabellenform.
2. **Abhängigkeiten zwischen Abrechnungsnummern sind erstklassige Daten.** Die
   Gebührenordnungen verbieten, beschränken und verknüpfen Nummern in den
   „Allgemeinen Bestimmungen" und in Inline-Hinweisen. Diese Regeln werden
   maschinenprüfbar modelliert (`constraints` je Eintrag, `constraintGroups`
   übergreifend), damit der Parser eine **ganze Rechnung** validieren kann –
   nicht nur einzelne Zeilen.
3. **Auditierbar & reproduzierbar.** Jeder Constraint trägt den
   Original-Gesetzeswortlaut (`sourceText`); jede Tabelle trägt ihre Provenienz
   (`source`). Re-Generierung erzeugt nachvollziehbare Diffs.
4. **Keine Rückwärtskompatibilität nötig.** Die Tabellen werden ausschließlich
   reproduzierbar erzeugt (siehe CLAUDE.md). Bei Formatänderungen wird die
   `schema`-Version erhöht und alles neu generiert.

## 2. Struktur der drei Quellen (Befund aus `data/input/`)

Alle drei Quell-XML (`gesetze-im-internet.de`, `gii-norm.dtd`) betten das
Gebührenverzeichnis als CALS-Tabellen ein. Spaltenlayout je Ordnung:

| Ordnung | Spalten der Verzeichnis-Tabelle | Preisbasis |
|---|---|---|
| **GOÄ** | Nummer · Leistung · Punktzahl · ~~Gebühr in DM~~ | Punktzahl × **5,82873 ct** (§5 Abs. 1) |
| **GOZ** | Nummer · Leistung · Punktzahl | Punktzahl × **5,62421 ct** (§5 Abs. 1) |
| **GOT** | Nummer · Leistung · **Euro-Betrag** | Eurobetrag direkt (keine Punkte) |

Wichtig:

- Die GOÄ-Spalte **„Gebühr in DM" ist Altbestand und wird ignoriert** –
  `baseAmount` wird immer aus `Punktzahl × Punktwert` berechnet.
- Manche Nummern drucken **keinen eigenen Betrag** in der Punktzahl-Spalte, sind
  aber echte Abrechnungsnummern: die Analyt-Nummern der Labor-**Kataloge**
  (Abschnitt M) werden zum Punktwert der vorangestellten Methoden-Kopfzeile
  abgerechnet und erhalten deren `points`; **prozentuale Zuschläge** (z. B.
  GOÄ 5298 „25 v.H. …", GOÄ 441, GOZ 0120) und **GOZ-Teilleistungen**
  (Hälfte/drei Viertel der jeweiligen Gebühr) haben keinen festen Betrag und
  erhalten `points: null`, `baseAmount: 0` (siehe §4).
- Der **Punktwert ist versioniert/konfigurierbar** (`pointValueCents`), nicht
  in die Beträge „eingebrannt", damit eine Punktwertänderung ohne Neu-Parsen
  der Leistungstexte nachvollzogen werden kann.
- GOT hat ein **anderes Faktorsystem** (kein §5-Schwellenwert wie 2,3) und
  praktisch keine Nummern-Abhängigkeiten; es füllt nur die `default`-Kategorie.

## 3. Top-Level-Schema

```jsonc
{
  "schema": "fee-schedule/v1",
  "feeSchedule": "GOÄ",                 // "GOÄ" | "GOZ" | "GOT"
  "version": "1996-neugefasst",
  "source": {                           // Provenienz, aus XML-Metadaten
    "law": "GOÄ 1982 (neugefasst 1996)",
    "file": "data/input/goae/BJNR015220982.xml",
    "doknr": "BJNR015220982",
    "lawStatus": "zuletzt geändert durch Art. 3b G v. 19.7.2023 I Nr. 197",
    "buildDate": "20260506174941"
  },
  "pointValueCents": 5.82873,           // null bei GOT
  "currency": "EUR",
  "multiplierLimits": {                 // §5-Grenzen je Kategorie
    "default":   { "regelhoechstsatz": 2.3,  "hoechstsatz": 3.5 },
    "technical": { "regelhoechstsatz": 1.8,  "hoechstsatz": 2.5 },
    "lab":       { "regelhoechstsatz": 1.15, "hoechstsatz": 1.3 },
    "inpatient": { "regelhoechstsatz": 1.8,  "hoechstsatz": 2.5 }
  },
  "entries": { /* Ziffer → Eintrag */ },
  "constraintGroups": [ /* nummernübergreifende Regeln */ ]
}
```

## 4. Eintrag (`FeeEntry`)

```jsonc
"1": {
  "ziffer": "1",
  "description": "Beratung, auch mittels Fernsprecher",
  "points": 80,                 // Punktzahl; null bei GOT
  "baseAmount": 4.66,           // points × pointValueCents/100 bzw. Euro (GOT)
  "category": "default",        // default | technical | lab | inpatient (§5)
  "benefitCategory": "ambulant", // Tarif-Leistungsbereich (§3.2 included_benefits)
  "maxMultiplier": 2.3,         // Schwellenwert zum Flaggen (§5 Regelhöchstsatz)
  "isSurcharge": false,         // true bei Zuschlägen
  "section": { "part": "M", "code": "B I", "title": "…" },
  "notes": ["frei-textliche Hinweise, die nicht als Constraint modellierbar sind"],
  "constraints": [ /* siehe §5 */ ]
}
```

- **`ziffer`** ist der Schlüssel des `entries`-Objekts und exakt wie gedruckt
  (`"1"`, `"75"`, `"1829a"`, GOZ `"0010"`). Der Parser **normalisiert beim
  Nachschlagen** (führende Nullen strippen), damit `"0001"` und `"1"` matchen.
- **`points`/`baseAmount`** sind `null` bzw. `0` für **abgeleitet bepreiste**
  GOÄ/GOZ-Einträge ohne festen Betrag: prozentuale Zuschläge und
  GOZ-Teilleistungen (der konkrete Betrag ergibt sich aus der Basisleistung).
  Labor-Katalog-Nummern hingegen tragen den geerbten Katalog-`points`-Wert (§2).
- **`category`** wird aus dem Abschnitt der Quelle abgeleitet (GOÄ Teil M →
  `lab`, technische Abschnitte → `technical`, …) und mappt über
  `multiplierLimits` auf die §5-Steigerungsgrenzen.
- **`benefitCategory`** ist der Tarif-Leistungsbereich (`included_benefits`,
  Design §3.2), nach dem die Erstattungs-Engine die Positionen gruppiert. Zur
  Build-Zeit deterministisch aus Gebührenordnung + Nummernkreis abgeleitet: GOZ
  `5xxx`/`9xxx` → `zahnersatz`, `6xxx` → `kieferorthopaedie`, übrige GOZ →
  `zahnbehandlung`; alle GOÄ → `ambulant`; GOT → `sonstiges`. Es ist der aus den
  Daten ableitbare **Default** — die Unterscheidung ambulant↔stationär und die
  Nicht-GOÄ/GOZ-Bereiche (`heilmittel`/`hilfsmittel`) hängen vom Rechnungskontext
  ab und werden vom Aufrufer gesetzt, nicht von der Tabelle.
- **`maxMultiplier`** ist der Wert, gegen den der Parser den
  Steigerungsfaktor einer Position flaggt – i. d. R. der `regelhoechstsatz` der
  Kategorie, in Sonderfällen ein gesetzlicher Eintrags-Override.

## 5. Abhängigkeitsmodell — der Kern

In den Quelldaten wurden folgende wiederkehrende Abhängigkeitsmuster gefunden
(Häufigkeit GOÄ / GOZ / GOT):

| Muster | Beispiel-Wortlaut | Modellierung | GOÄ | GOZ | GOT |
|---|---|---|---|---|---|
| Gerichteter Ausschluss | „Leistung nach Nr. 4 ist **neben** den Nummern 30, 34 … **nicht** berechnungsfähig" | `excludes` am Eintrag | ✓ | ✓ | – |
| Gegenseitiger Ausschluss | „Nummern 271 bis 276 sind **nicht nebeneinander** berechnungsfähig" | `constraintGroups[mutualExclusion]` | ✓ | ✓ | – |
| Zuschlag (benötigt Basis) | „**Zuschlag zu** den Leistungen nach Nummer 45, 46 …" | `requires` + `isSurcharge` | 109× | 20× | 1× |
| Bestandteil von | „… ist **Bestandteil** der Leistungen nach den Nummern 270 bis 287" | `componentOf` | ✓ | ✓ | – |
| Frequenzlimit | „**je Sitzung**" / „**je Behandlungstag**" / „**im Behandlungsfall**" / „**nur einmal**" | `maxFrequency` | ✓ | ✓ | 1× |
| Höchstwert (Betragsdeckel) | „**Höchstwert** für Leistungen nach Nummer 393, je Tag" | `constraintGroups[maxAmount]` | 31× | – | – |
| Mindestdauer | „**Mindestdauer** … 20 Min." | `minDuration` | 10× | 1× | – |
| Altersbedingung | „bei **Kindern bis zum vollendeten 4. Lebensjahr**" | `ageLimit` | ✓ | ✓ | – |
| Fester Gebührensatz | „nur mit dem **einfachen Gebührensatz** berechnungsfähig" | `fixedFactor` | ✓ | – | – |

### 5.1 Constraint am Eintrag (`constraints[]`)

Diskriminierte Union über `type`. Jeder Constraint trägt `sourceText` (Original).

```jsonc
// Nicht neben anderen Nummern abrechenbar (deckt "nebeneinander" und "neben … nicht")
{ "type": "excludes", "ziffern": ["6","7","8"], "scope": "session"?, "sourceText": "…" }

// Zuschlag/Add-on: nur zusammen mit mindestens einer Basisnummer
{ "type": "requires", "anyOf": ["45","46","48"], "sourceText": "Zuschlag zu …" }

// In einer anderen Leistung enthalten → nicht separat abrechenbar
{ "type": "componentOf", "ziffern": ["270","287"], "sourceText": "… ist Bestandteil …" }

// Höchstens count× je Zeitfenster
{ "type": "maxFrequency", "count": 1, "scope": "case", "sourceText": "im Behandlungsfall nur einmal" }

// Mindestdauer der Leistung
{ "type": "minDuration", "minutes": 20, "sourceText": "Dauer mindestens 20 Minuten" }

// Altersgrenze (typisch bei Zuschlägen)
{ "type": "ageLimit", "maxAgeYears": 4, "sourceText": "bei Kindern bis zum vollendeten 4. Lebensjahr" }

// Nur mit festem Gebührensatz (kein Steigerungsfaktor)
{ "type": "fixedFactor", "factor": 1.0, "sourceText": "nur mit dem einfachen Gebührensatz" }
```

**`scope` (Zeitfenster)** für `maxFrequency`/`excludes`: `session` (je Sitzung),
`day` (je Behandlungstag/Tag), `case` (im Behandlungsfall = dieselbe Erkrankung
binnen eines Monats, §5 Allg. Best.), `occasion` (je Inanspruchnahme), `year`,
`lifetime` — offen für seltene domänenspezifische Fenster.

### 5.2 Nummernübergreifende Regeln (`constraintGroups[]`)

Manche Regeln gehören keinem einzelnen Eintrag, sondern einer **Menge** von
Nummern:

```jsonc
// Aus einer Gruppe ist nur eine Nummer abrechenbar
{ "id": "excl-271-276", "type": "mutualExclusion",
  "members": ["271","272","273","274","275","276"],
  "sourceText": "Die Leistungen nach den Nummern 271 bis 276 sind nicht nebeneinander berechnungsfähig." }

// Betragsdeckel über eine Gruppe je Zeitfenster (Höchstwert)
{ "id": "hoechstwert-3630-3631", "type": "maxAmount",
  "members": ["3630","3631"], "amount": 11.66, "scope": "case", "cappingZiffer": "3633",
  "sourceText": "Höchstwert für die Untersuchungen nach den Nummern …" }
```

#### 5.2.1 `excludes` vs. `mutualExclusion` — bewusst zwei Formen

Beide drücken **dieselbe** Tatsache aus: „diese Nummern dürfen nicht zusammen
abgerechnet werden", und diese Unverträglichkeit ist **immer symmetrisch**.
Der Unterschied ist rein die **Form** der Beziehung, die jede kompakt abbildet:

- **`excludes` = Stern.** Eine Nummer gegen eine Liste. Sagt **nichts** darüber
  aus, ob die gelisteten Nummern untereinander kollidieren. Beispiel: „Nr. 4 ist
  neben 30, 34, 801 … nicht berechnungsfähig" — verboten sind 4↔30, 4↔34, 4↔801;
  30↔34 bleibt erlaubt.
- **`mutualExclusion` = Clique.** Ein ganzer Block, in dem **jede** Nummer mit
  **jeder** anderen kollidiert. Beispiel: „Nummern 271 bis 276 nicht
  nebeneinander" — alle Paare innerhalb 271…276 sind verboten.

Beide Formen kommen real in den Quelldaten vor und sind **nicht ineinander
überführbar**, ohne Information zu verlieren oder zu erfinden: Eine Clique ließe
sich zwar als `excludes` an jedem Mitglied schreiben (redundant), ein Stern aber
**nicht** zu einer Clique zusammenfassen (das erfände das Verbot 30↔34).

**Warum beide behalten** (statt alles auf `excludes`-Paare zu reduzieren):
Ein `mutualExclusion`-Eintrag ist **ein** Gesetzessatz mit **einem** `id` und
**einem** `sourceText`. Diese Klammer bleibt erhalten, damit die spätere Prüfung
**genau diese eine Regel als „angewendet" ausweisen** kann (z. B. „Regel
`excl-271-276`: Nummern 271–276 nicht nebeneinander → angewendet auf 271, 274"),
statt einer anonymen Menge von Paaren. Würde man die Gruppe in per-Eintrag-Paare
auflösen, ginge sowohl diese Nachvollziehbarkeit als auch die einfache,
einmalige Pflege verloren.

**Konsequenz für den Parser** (§6): `excludes` ist symmetrisch zu behandeln —
ein `(4, 30)`-Konflikt ist ein Verstoß, egal ob die Kante an 4 oder an 30
gespeichert ist (das Gesetz nennt sie meist nur einseitig). Für die reine
Konflikterkennung normalisieren `excludes` und `mutualExclusion` zu derselben
symmetrischen Inkompatibilitäts-Paarmenge (ein Prüfpfad); für die Anzeige bleibt
die ursprüngliche Regel-Identität (`id`/`sourceText`) erhalten.

## 6. Validierungsregeln (CI)

Der Validator (`scripts/validate-fee-schedules.mjs`, dependency-frei) prüft:

1. **Schema-Konformität** gegen `data/schema/fee-schedule.schema.json` (die
   Prüfungen hier spiegeln dessen Invarianten; das Schema bleibt der
   maßgebliche Vertrag und wird zusätzlich extern z. B. mit ajv geprüft).
2. **Eindeutigkeit** der Ziffern (Schlüssel == `entry.ziffer`).
3. **Referenzielle Integrität:** jede in `constraints`/`constraintGroups`
   referenzierte Ziffer existiert in `entries` (oder ist als bewusst externer
   Verweis dokumentiert).
4. **Preis-Plausibilität:** GOÄ/GOZ `baseAmount ≈ points × pointValueCents/100`
   (Rundungstoleranz) oder – bei abgeleitet bepreisten Zuschlägen/Teilleistungen –
   `points === null` mit `baseAmount === 0`; GOT `points === null`; `baseAmount ≥ 0`.
5. **§5-Konsistenz:** `maxMultiplier` passt zur `category` bzw. ist ein
   begründeter Override; `category` existiert in `multiplierLimits`.
6. **Symmetrie:** `excludes` darf einseitig sein — das ist **kein** Fehler (das
   Gesetz nennt die Regel meist nur an einer Nummer, siehe §5.2.1). Der Validator
   meldet einseitige Kanten daher **nicht**; er stellt nur sicher, dass die
   Konflikterkennung sie symmetrisch normalisiert (Self-Test: `(A,B)` wird aus
   `A.excludes=[B]` ebenso gefunden wie aus `B.excludes=[A]`).

## 7. Generierung & Tooling

Beides ist dependency-frei (`node`, keine externen Pakete — wie
`scripts/check-licenses.mjs`):

- **`scripts/build-fee-schedules.mjs`** (`pnpm fees:build`) parst die CALS-
  Tabellen unter `data/input/` und schreibt `frontend/src/lib/data/{goae,goz,
  got}.json` inkl. `source`-Provenienz. Hilfsmodule: `scripts/lib/mini-xml.mjs`
  (winziger XML-Parser), `scripts/lib/fee-constraints.mjs` (Constraint-Extraktion).
- **`scripts/validate-fee-schedules.mjs`** (`pnpm fees:validate`) prüft die in
  §6 genannten Regeln.

CI (`.github/workflows/ci.yml`) baut die Tabellen neu, erzwingt per
`git diff --exit-code`, dass die eingecheckten Tabellen reproduzierbar zur
Quelle passen (keine veralteten/handeditierten Tabellen), und validiert sie.

**Aktueller Stand der generierten Tabellen** (Richtwerte): GOÄ ~2.766 Ziffern,
GOZ ~215, GOT ~1.006. Die Constraint-Extraktion ist hochpräzise, aber nicht
vollständig: Sätze, die kein bekanntes Muster treffen, werden als `notes`
(Freitext mit Wortlaut) erhalten — es geht nichts verloren.

Nummern **ohne eigenen Betrag** in der Quelle sind trotzdem echte
Abrechnungsnummern und als Einträge enthalten: die Analyt-Nummern der Labor-
**Kataloge** (Abschnitt M) zum Punktwert ihrer Methoden-Kopfzeile, prozentuale
**Zuschläge** (z. B. 5298, 441, GOZ 0120) und **GOZ-Teilleistungen** (2230, 2240,
5050, 5060, 5240) mit `points: null`/`baseAmount: 0`. **Nicht** als Einträge
enthalten sind allein die reinen Buchstaben-Zuschläge der GOÄ (A–K, Abschnitte
A/B.II; mehrdeutige, kollidierende Schlüssel); ihre numerischen Bezüge bleiben
über die Zuschlags-Beschreibungen erhalten.

**Bekannte Quell-Eigenheit (korrigiert):** Im amtlichen XML ist „Lithium"
fälschlich als GOÄ-Nr. **4114** ausgezeichnet — 4114 ist aber der
„Renin-Aldosteron-Suppressionstest"; Lithium ist Nr. **4214** (steht in
Abschnitt M direkt hinter 4210–4213). Unkorrigiert kollidieren beide Zeilen und
der echte 4114 ginge verloren. `scripts/build-fee-schedules.mjs` korrigiert das
über die `SOURCE_ERRATA`-Tabelle (4114→4214, nur die „Lithium"-Zeile); der Build
gibt die angewandte Korrektur aus und **bricht ab**, falls eine unerwartete
doppelte Ziffer auftaucht (dann fehlt eine Errata-Regel). Da
`scripts/fetch-sources.mjs` die Quelle monatlich neu lädt, kann die Korrektur
nicht in der XML erfolgen, sondern muss im Build liegen.

### Automatische monatliche Auffrischung

`.github/workflows/update-fee-sources.yml` läuft monatlich (und per
`workflow_dispatch`), lädt die amtlichen XML frisch von
gesetze-im-internet.de (`scripts/fetch-sources.mjs`: `go__1982`, `goz_1987`,
`got_2022`), baut + validiert die Tabellen neu und öffnet bei Änderungen einen
PR auf Branch `automation/fee-schedule-update`. Der PR ist ein **Vorschlag** —
der Maintainer (@justb81) reviewt und merged (CODEOWNERS).

Hinweis: Der Default-`GITHUB_TOKEN` löst auf dem erzeugten PR **keine** CI aus
(GitHub-Einschränkung). Für automatisch laufende Checks ein PAT als Secret
`FEE_UPDATE_TOKEN` hinterlegen; sonst die Checks manuell anstoßen.

### Re-Generierungs-Workflow (Maintainer, @justb81, manuell)

1. Quelle unter `data/input/<ordnung>/*.xml` aktualisieren (oder
   `node scripts/fetch-sources.mjs`).
2. `pnpm fees:build` → erzeugt die JSON-Tabellen neu.
3. `pnpm fees:validate` (lokal == CI).
4. **Diff prüfen** und committen. Die Tabellen werden ausschließlich vom
   Maintainer gepflegt (siehe CLAUDE.md / #7).
