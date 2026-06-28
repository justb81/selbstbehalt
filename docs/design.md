# PKV Manager – Design-Dokument

> **Zweck dieses Dokuments:** Vollständige technische und fachliche Spezifikation für einen selbst-gehosteten PKV-Verwaltungs-Manager als Progressive Web App (PWA). Dieses Dokument dient als Entwicklungsbasis für einen AI-Coding-Agenten.

***

## 1. Projektziel & Kontext

### 1.1 Problemstellung

Privat Krankenversicherte (PKV) in Deutschland stehen vor mehreren Verwaltungsaufgaben, für die es keine vollständige, datenschutzkonforme und selbst-hostbare Softwarelösung gibt:

- Mehrere PKV-Verträge (Vollversicherung + Zusatztarife, ggf. Beihilfe) zentral verwalten
- Arztrechnungen nach GOÄ, GOZ, GOT etc. erfassen, prüfen und archivieren
- Die sogenannte **Günstigerprüfung** durchführen: Soll eine Rechnung bei der PKV eingereicht werden, oder lohnt es sich, sie selbst zu zahlen, um die Beitragsrückerstattung (BRE) zu erhalten?

Bestehende Apps (PKV Go, RechnungsDoc Mobil, Belegkompass) lösen Teile davon, sind jedoch iOS-only, nicht self-hostbar und proprietär [^1][^2][^3]. Eine Open-Source-Alternative existiert nicht in produktionsreifem Zustand [^4].

### 1.2 Zielgruppe

- Einzelpersonen und Familien mit PKV-Vollversicherung oder PKV-Zusatztarifen
- Technisch versierte Nutzer, die Selbst-Hosting bevorzugen (Proxmox, Docker, NAS)
- Nutzer mit Android-Geräten (derzeit von bestehenden Apps ausgeschlossen)

### 1.3 Designprinzipien

1. **Privacy by Design:** Sensible Gesundheitsdaten (Rechnungsbilder, Diagnosen) verlassen das Gerät des Nutzers nie unverschlüsselt. OCR und KI-Verarbeitung erfolgen client-seitig im Browser.
2. **Offline-first:** Kerndaten sind auch ohne aktive Serververbindung zugänglich.
3. **Minimal-Server:** Der Backend-Server dient nur als persistente Datenbank und REST-API; keine KI-Workloads serverseitig.
4. **DSGVO-konform:** Gemäß Art. 9 DSGVO gilt für Gesundheitsdaten erhöhter Schutzbedarf. Durch vollständige Selbst-Hostebarkeit entfällt eine Datenübertragung an Dritte.

***

## 2. Systemarchitektur

### 2.1 Überblick

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (Browser PWA)                │
│                                                         │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │ Kamera   │──▶│ PaddleOCR.js │──▶│ GOÄ-Parser      │ │
│  │ getUserM │   │ (PP-OCRv5)   │   │ (Regex + Lookup) │ │
│  │ edia API │   │ WebGPU/WASM  │   └────────┬────────┘ │
│  └──────────┘   └──────────────┘            │           │
│                                             ▼           │
│  ┌─────────────────────────────────────────────────┐   │
│  │           SvelteKit PWA (Frontend)              │   │
│  │  - Vertragsansicht    - Günstigerprüfung        │   │
│  │  - Rechnungserfassung - Statistiken             │   │
│  └──────────────────────┬──────────────────────────┘   │
│                         │ JSON (nur Metadaten, kein Bild)│
└─────────────────────────┼───────────────────────────────┘
                          │ HTTPS (Heimnetz / VPN)
┌─────────────────────────▼───────────────────────────────┐
│                  BACKEND (Docker / Proxmox LXC)         │
│                                                         │
│   ┌─────────────────┐      ┌────────────────────────┐  │
│   │  FastAPI / Hono │      │  SQLite (primary)       │  │
│   │  REST API       │◀────▶│  oder PostgreSQL         │  │
│   │  Port 8080      │      │  (für Mehrbenutzerbetrieb)│  │
│   └─────────────────┘      └────────────────────────┘  │
│   RAM: ~128 MB, kein GPU, kein LLM                      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Technologie-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| **Frontend** | SvelteKit (TypeScript) | Leichtgewichtig, SSR optional, PWA-Support nativ |
| **OCR Engine** | PaddleOCR.js 3.5 (PP-OCRv5) | Browser-native, WebGPU + WASM Fallback, 40+ Sprachen, kein Server [^5][^6] |
| **AI-Beschleunigung** | WebGPU API (Chrome/Edge) + WebNN (Android NPU) | Standard in Chrome seit 2025, ~82% Browser-Coverage [^7] |
| **Fallback OCR** | WASM-Build von PaddleOCR | Wenn kein WebGPU verfügbar |
| **GOÄ-Prüfung** | Statische JSON-Lookup-Tabelle + Regex-Parser | GOÄ ist öffentlich, kein LLM nötig |
| **Backend API** | Hono (TypeScript) oder FastAPI (Python) | Minimal, Docker-freundlich |
| **Datenbank** | SQLite (via Drizzle ORM) | Kein separater DB-Dienst nötig, Backup trivial |
| **Deployment** | Docker Compose | Kompatibel mit Proxmox LXC, Portainer |
| **PWA-Features** | Service Worker, Web App Manifest | Installierbar auf Android/Desktop, Offline-Cache |

### 2.3 Deployment-Anforderungen (Server)

- **CPU:** 1 vCore reicht
- **RAM:** 128–256 MB
- **Speicher:** 1–5 GB (SQLite + hochgeladene PDF-Kopien optional)
- **Netzwerk:** Nur im Heimnetz erreichbar + optional Tailscale/VPN für mobilen Zugriff
- **Kein GPU, kein LLM-Backend** – alle KI-Aufgaben laufen client-seitig [^6][^8]

***

## 3. Datenmodell

### 3.1 Entitäts-Übersicht

```
Person  (1) ──── (n) Vertrag             (als Versicherungsnehmer)
Vertrag (1) ──── (n) VersichertePerson   (versicherte Person auf dem Vertrag, je eigene KVNR)
Person  (1) ──── (n) VersichertePerson   (eine Person kann auf mehreren Verträgen versichert sein)
VersichertePerson (1) ──── (n) Rechnung
Rechnung (1) ──── (n) Rechnungsposition (GOÄ-Ziffer)
Rechnung (1) ──── (1) Einreichung (optional)
VersichertePerson (1) ──── (n) BRE-Periode (Beitragsrückerstattungs-Zeitraum)
```

Ein **Vertrag** (Hauptvertrag/Versicherungsschein) hat genau einen **Versicherungsnehmer**
(`persons`-Eintrag, der den Vertrag hält und die Beiträge zahlt) und ein oder mehrere
**versicherte Personen**. Jede versicherte Person hat eine eigene **Krankenversichertennummer
(KVNR)** sowie einen eigenen Tarif, Beitrag, Selbstbehalt und eigene Beitragsrückerstattung auf
dem gemeinsamen Vertrag. Rechnungen und BRE-Perioden hängen daher an der **versicherten Person**,
nicht am Vertrag.

### 3.2 Tabellen-Schema (SQLite / Drizzle ORM)

#### `persons`
```sql
id          TEXT PRIMARY KEY  -- UUID
name        TEXT NOT NULL
birth_date  DATE
created_at  DATETIME
```

Eine natürliche Person. Ob sie Versicherungsnehmer und/oder versicherte Person ist, ergibt sich
aus den Verknüpfungen (`contracts.policyholder_id` bzw. `insured_persons.person_id`) — derselbe
`persons`-Eintrag kann beides zugleich sein.

#### `contracts`

Der Hauptvertrag (Versicherungsschein): Versicherer, Vertragsnummer und Versicherungsnehmer. Die
tarifspezifischen Größen (Tarif, Beitrag, Selbstbehalt, BRE, Leistungen) liegen je versicherter
Person in `insured_persons`.

```sql
id                    TEXT PRIMARY KEY
policyholder_id       TEXT REFERENCES persons(id)  -- Versicherungsnehmer
insurer_name          TEXT NOT NULL          -- z.B. "DKV", "Allianz"
contract_number       TEXT                   -- Vertrags-/Versicherungsscheinnummer
type                  TEXT NOT NULL          -- 'vollversicherung' | 'zusatztarif' | 'beihilfe'
start_date            DATE NOT NULL
end_date              DATE                   -- NULL = laufend
notes                 TEXT
created_at            DATETIME
```

#### `insured_persons`

Eine versicherte Person auf einem Vertrag — die Verknüpfung von `persons` und `contracts`, die den
individuellen Versicherungsschutz trägt. Jeder Eintrag hat eine eigene KVNR und eigene Tarif-,
Beitrags-, Selbstbehalt- und BRE-Werte.

```sql
id                    TEXT PRIMARY KEY
contract_id           TEXT REFERENCES contracts(id)
person_id             TEXT REFERENCES persons(id)
kvnr                  TEXT                   -- Krankenversichertennummer dieser Person auf dem Vertrag
tariff_name           TEXT                   -- z.B. "KomfortSelect"
monthly_premium       REAL NOT NULL          -- Monatsbeitrag dieser Person in EUR
self_retention        REAL DEFAULT 0         -- Selbstbehalt p.a. dieser Person in EUR
bre_structure         TEXT                   -- JSON: Staffelung der Beitragsrückerstattung
included_benefits     TEXT                   -- JSON: Array von enthaltenen Leistungen
start_date            DATE                   -- Beginn des Versicherungsschutzes dieser Person
end_date              DATE                   -- NULL = laufend
notes                 TEXT
created_at            DATETIME
```

**`bre_structure` JSON-Beispiel:**
```json
{
  "type": "staffel",
  "levels": [
    { "leistungsfrei_months": 12, "bre_months": 1, "pct_of_premium": 100 },
    { "leistungsfrei_months": 24, "bre_months": 2, "pct_of_premium": 100 },
    { "leistungsfrei_months": 36, "bre_months": 3, "pct_of_premium": 100 }
  ],
  "current_streak_start": "2024-01-01"
}
```

**`included_benefits` JSON-Beispiel:**

Bildet die tarifspezifischen Erstattungsregeln je Leistungsbereich ab. Pro Baustein lassen sich
die vier in der PKV-/Zusatzwelt üblichen Stellschrauben kombinieren: **Erstattungssatz** (Prozent),
**Schwellen-Staffel** innerhalb eines Falls/Jahres (z.B. „bis 500 € zu 100 %, darüber 70 %"),
**Summenbegrenzungen** (pro Fall / pro Jahr / lebenslang, optional altersabhängig) und die
**Aufbaujahres-Staffel** (Zahnstaffel: kumuliertes Limit, das in den ersten Jahren ansteigt und
dann entfällt) sowie **Wartezeiten**. Für beihilfekonforme Tarife ist `pct` die Restquote zum
Beihilfeanspruch (`beihilfe_satz`).

```json
{
  "benefits": [
    {
      "category": "kieferorthopaedie",
      "waiting_period_months": 8,
      "beihilfe_satz": 0,
      "tiers": [
        { "up_to": 500, "pct": 100 },
        { "up_to": null, "pct": 70 }
      ],
      "limits": [
        { "scope": "behandlung", "max_amount": 3000 },
        { "scope": "jahr", "max_amount": null, "age_max": 18 }
      ],
      "annual_staffel": [
        { "policy_year": 1, "cumulative_cap": 1000 },
        { "policy_year": 2, "cumulative_cap": 2000 },
        { "policy_year": 5, "cumulative_cap": null }
      ]
    }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `category` | Leistungsbereich: `ambulant` \| `stationaer` \| `zahnbehandlung` \| `zahnersatz` \| `kieferorthopaedie` \| `heilmittel` \| `hilfsmittel` \| `wahlleistung` \| `sonstiges` |
| `waiting_period_months` | Wartezeit in Monaten ab Vertragsbeginn; Rechnungen davor sind nicht erstattungsfähig (`0` = keine) |
| `beihilfe_satz` | Beihilfe-Bemessungssatz in % (0 = kein Beihilfeanspruch); der Tarif trägt die Restquote |
| `tiers` | Schwellen-Staffel: erstattet `pct` % bis zum Betrag `up_to` (EUR), darüber der nächste Eintrag; `up_to: null` = darüber hinaus |
| `limits` | Höchstgrenzen; `scope`: `behandlung` \| `jahr` \| `lebenslang`; `max_amount: null` = unbegrenzt; optional `age_max`/`age_min` |
| `annual_staffel` | Aufbaujahres-Staffel (Zahnstaffel): kumuliertes Limit `cumulative_cap` (EUR) je `policy_year`; letzter Eintrag mit `cumulative_cap: null` = ab diesem Jahr unbegrenzt |

#### `invoices`
```sql
id                TEXT PRIMARY KEY
insured_person_id TEXT REFERENCES insured_persons(id)  -- welche versicherte Person die Rechnung betrifft
invoice_date      DATE NOT NULL
invoice_number    TEXT
provider_name     TEXT NOT NULL        -- Name des Arztes / der Einrichtung
provider_type     TEXT                 -- 'arzt' | 'zahnarzt' | 'krankenhaus' | 'sonstiges'
total_amount      REAL NOT NULL        -- Rechnungsbetrag brutto in EUR
eligible_amount   REAL                 -- Nach GOÄ erstattungsfähiger Betrag
self_paid_amount  REAL DEFAULT 0       -- Selbst getragener Betrag (inkl. Selbstbehalt)
status            TEXT DEFAULT 'neu'   -- 'neu' | 'geprüft' | 'eingereicht' | 'erstattet' | 'abgelehnt' | 'selbst_gezahlt'
decision          TEXT                 -- 'einreichen' | 'selbst_zahlen' (Günstigerprüfung-Ergebnis)
file_path         TEXT                 -- Pfad zur gespeicherten PDF/Bild-Datei (optional)
ocr_raw           TEXT                 -- Roh-OCR-Text (für Debugging)
notes             TEXT
created_at        DATETIME
```

#### `invoice_positions`
```sql
id               TEXT PRIMARY KEY
invoice_id       TEXT REFERENCES invoices(id)
goae_number      TEXT NOT NULL      -- GOÄ-Ziffer, z.B. "0340"
goae_category    TEXT               -- 'GOÄ' | 'GOZ' | 'GOT' | 'UV-GOÄ'
description      TEXT               -- Leistungsbeschreibung aus GOÄ-Lookup
multiplier       REAL NOT NULL      -- Steigerungsfaktor, z.B. 2.3
base_amount      REAL NOT NULL      -- 1-facher Betrag laut GOÄ
charged_amount   REAL NOT NULL      -- In Rechnung gestellter Betrag
is_valid         BOOLEAN            -- Steigerungsfaktor innerhalb Regelgrenze?
flag_reason      TEXT               -- Begründung bei Auffälligkeit
```

#### `submissions`
```sql
id               TEXT PRIMARY KEY
invoice_id       TEXT REFERENCES invoices(id)
submitted_at     DATETIME
submitted_via    TEXT          -- 'app' | 'post' | 'email'
expected_refund  REAL          -- Erwartete Erstattung
actual_refund    REAL          -- Tatsächlich erhaltene Erstattung
refund_date      DATE
rejection_reason TEXT
```

#### `bre_periods`
```sql
id                TEXT PRIMARY KEY
insured_person_id TEXT REFERENCES insured_persons(id)
year              INTEGER NOT NULL
streak_months     INTEGER DEFAULT 0    -- Leistungsfreie Monate
bre_amount        REAL DEFAULT 0       -- Bereits erzielte BRE in diesem Jahr
projected_bre     REAL                 -- Erwartete BRE bei Leistungsfreiheit
```

***

## 4. OCR-Pipeline (Client-seitig)

### 4.1 Ablauf

```
1. Nutzer fotografiert Rechnung (Kamera) oder wählt PDF/Bild
        ↓
2. Bildvorverarbeitung (Canvas API):
   - Graustufen-Konvertierung
   - Kontrast-Verstärkung
   - Entzerrung (perspektivische Korrektur via Homographie, optional)
        ↓
3. PaddleOCR.js PP-OCRv5 (WebGPU):
   - Texterkennung → Array von { text, bbox, confidence }
        ↓
4. GOÄ-Strukturparser:
   - Regex-Extraktion der Rechnungsfelder
   - GOÄ-Ziffer-Lookup
   - Validierung
        ↓
5. Ergebnis-JSON → Review-Screen → bei Bestätigung: API POST
```

### 4.2 PaddleOCR.js Integration

PaddleOCR 3.5 bietet seit April 2026 ein offizielles JavaScript-SDK mit WebGPU-Beschleunigung für alle modernen Browser [^5][^6]. Die Initialisierung:

```typescript
// ocr-worker.ts (Web Worker für Non-blocking UI)
import { PPOCRv5 } from '@paddle-js-models/ocr';

let ocrModel: PPOCRv5 | null = null;

async function initOCR() {
  ocrModel = new PPOCRv5({
    backend: 'webgpu',   // Fallback: 'wasm'
    language: 'de',      // Deutsch
    quantized: true,     // INT8 für schnelleren Download
  });
  await ocrModel.init();
}

async function recognizeImage(imageData: ImageData): Promise<OCRResult[]> {
  if (!ocrModel) await initOCR();
  const results = await ocrModel.recognize(imageData);
  return results.map(r => ({
    text: r.text,
    confidence: r.score,
    bbox: r.bbox,
  }));
}
```

**Wichtig:** OCR läuft in einem **Web Worker**, damit der UI-Thread während der Verarbeitung nicht blockiert.

### 4.3 GOÄ-Strukturparser

Arztrechnungen nach §12 GOÄ folgen einem gesetzlich definierten Schema. Der
Parser (`frontend/src/lib/utils/goae-parser.ts`) ist reiner, deterministischer
Code (kein LLM) und die **Konsumentenseite** des `fee-schedule/v1`-Formats
(siehe `docs/data-format.md`, `frontend/src/lib/data/fee-schedule.ts`). Er
arbeitet in vier Schritten:

1. **Feld- und Positionsextraktion** per Regex aus dem (OCR-)Text: Datum
   (→ ISO `YYYY-MM-DD`), Rechnungsnummer, Anbieter sowie die Positionszeilen.
   Eine Positionszeile beginnt mit einer Ziffer und endet mit einem
   Euro-Betrag; der abschließende Zahlen-Lauf wird von rechts als
   `[… Anzahl] Faktor Betrag` gelesen (deutsche Dezimal-/Tausenderzeichen,
   OCR-Rauschen tolerant). Eine explizite Mengenangabe (`2x`) wird erkannt.
2. **Lookup** jeder Ziffer in der generierten Tabelle (`{goae,goz,got}.json`,
   Typ `FeeScheduleTable`); die Ziffer wird beim Nachschlagen normalisiert
   (führende Nullen gestrippt). `baseAmount`/`category`/`benefitCategory`/
   `maxMultiplier` werden aus dem `FeeEntry` übernommen, nicht neu berechnet
   (`benefitCategory` = Tarif-Leistungsbereich für die Erstattungs-Engine, §5.1).
   Unbekannte Ziffern werden gekennzeichnet (kein Crash).
3. **Validierung pro Position (§5)**: Der Steigerungsfaktor wird gegen
   `maxMultiplier` des Eintrags (ersatzweise `multiplierLimits[category]`)
   geprüft — **die Grenzen kommen ausschließlich aus den Daten, nicht
   hartkodiert**. `fixedFactor`-Einträge werden gegen ihren festen
   Gebührensatz geprüft. Ergebnis: `isValid` + `flags` (mit `flag_reason`).
4. **Validierung über die ganze Rechnung** gegen das Abhängigkeitsmodell:
   `excludes`/`mutualExclusion` (symmetrisch normalisierte Inkompatibilitäts-
   Paare), `requires`, `componentOf`, `maxFrequency`, `maxAmount`,
   `minDuration` und `ageLimit`. Jeder Verstoß weist die angewendete Regel
   (`id`/`sourceText`) und die betroffenen Positionen aus. GOT hat keinen
   §5-Schwellenwert und praktisch keine Nummern-Abhängigkeiten.

Die zentralen Typen (`ParsedInvoice`, `ParsedPosition`, `ConstraintViolation`)
und Funktionen (`parseInvoice`, `lookupPosition`, `validateInvoice`) sind im
Quellmodul dokumentiert; die Validierungsregeln und Constraint-Typen in
`docs/data-format.md` §5.

### 4.4 GOÄ-Lookup-Tabelle

Die Gebührenordnung für Ärzte (GOÄ) ist öffentlich zugänglich und wird als statische JSON-Datei eingebunden. Struktur:

```json
{
  "0001": {
    "description": "Beratung, auch mittels Fernsprecher",
    "baseAmount": 4.66,
    "category": "default",
    "maxMultiplier": 2.3,
    "notes": "Nur einmal pro Tag ansetzbar"
  },
  "0340": {
    "description": "Erörterung (mind. 20 Min.), ggf. mit Angehörigen",
    "baseAmount": 20.11,
    "category": "default",
    "maxMultiplier": 3.5
  }
}
```

Die Tabelle umfasst alle ~4.500 Ziffern der GOÄ (aktuell GOÄ 1996 mit Anpassungskursfaktor), GOZ (Zahnärzte) und GOT (Tierärzte, für Haustierversicherung). Sie wird versioniert im Git-Repository gepflegt und ausschließlich vom Maintainer (@justb81) aktualisiert — reproduzierbar aus den amtlichen Quell-XML unter `data/input/` (siehe §10). Gefundene Fehler können als Issue gemeldet werden; externe PRs (Code, Daten o. a.) sind willkommen, müssen aber zwingend vom Maintainer reviewt und gemerged werden.

***

## 5. Erstattungsberechnung & Günstigerprüfung

### 5.1 Erstattungs-Engine (Vorstufe)

Die Günstigerprüfung setzt den Erstattungsbetrag $$R$$ (`eligible_amount`) als gegeben voraus.
Dieser wird von der **Erstattungs-Engine** aus den `included_benefits` der versicherten Person und den
geprüften Rechnungspositionen berechnet — sie übersetzt die tarifspezifischen Bausteine
(Erstattungssätze, Schwellen-Staffeln, Summengrenzen, Aufbaujahres-Staffel, Wartezeiten;
siehe `included_benefits` in §3.2) in den konkret erstattungsfähigen Betrag.

```typescript
// erstattungs-engine.ts

interface ErstattungPosition {
  category: BenefitCategory;        // benefitCategory aus dem GOÄ-Parser (+ ggf. Kontext-Override)
  chargedAmount: number;            // in Rechnung gestellter Betrag der Position
}

interface ErstattungInput {
  positions: ErstattungPosition[];  // aus dem GOÄ-Parser (charged_amount, benefitCategory)
  benefits: IncludedBenefits;       // included_benefits der versicherten Person
  invoiceDate: Date | string;       // für Wartezeit-/Aufbaujahres-Prüfung (injizierbar)
  coverageStart: Date | string;     // Beginn des Versicherungsschutzes der Person (insured_persons.start_date)
  patientAge?: number;              // Alter bei Rechnungsdatum, für altersabhängige limits
  priorClaimsByCategory?: Partial<Record<BenefitCategory, number>>;  // bereits ausgeschöpfte Staffel-/Jahresvolumina
}

interface ErstattungResult {
  eligibleAmount: number;           // R — Summe der erstattungsfähigen Beträge
  byCategory: Array<{
    category: BenefitCategory;
    chargedAmount: number;
    eligibleAmount: number;
    appliedPct: number;             // effektiver Erstattungssatz nach Staffel/Restquote
    cappedBy: 'tier' | 'limit' | 'annual_staffel' | 'waiting_period' | null;
    note?: string;                  // erklärender Text für die UI
  }>;
}
```

Die Positionen tragen ihre `benefitCategory` aus der Fee-Schedule-Tabelle (§4.4,
`FeeEntry.benefitCategory`); der ambulant↔stationär-Fall und Nicht-GOÄ/GOZ-Bereiche
werden vom Aufrufer aufgelöst. Berechnungsschritte je Kategorie-Gruppe:

1. **Wartezeit prüfen** — liegt `invoiceDate` vor `coverageStart + waiting_period_months`,
   ist der Betrag nicht erstattungsfähig (`appliedPct = 0`, `cappedBy = 'waiting_period'`).
2. **Schwellen-Staffel (`tiers`) anwenden** — den Rechnungsbetrag entlang der `up_to`-Grenzen
   in Tranchen aufteilen und je Tranche mit `pct` erstatten.
3. **Beihilfe berücksichtigen** — bei `beihilfe_satz > 0` deckt der Tarif nur die Restquote
   (`100 % − beihilfe_satz`); die Beihilfe trägt den Rest separat.
4. **Summengrenzen (`limits`) kappen** — pro `behandlung`/`jahr`/`lebenslang` und ggf. Alter.
5. **Aufbaujahres-Staffel (`annual_staffel`) kappen** — kumuliertes Limit des relevanten
   Policenjahres unter Berücksichtigung von `priorClaimsByCategory`.

Das Ergebnis (`eligibleAmount`) fließt als `erstattungsBetrag` (= $$R$$) in die Günstigerprüfung
(§5.3) ein.

### 5.2 Entscheidungslogik

Die Günstigerprüfung beantwortet: **Lohnt es sich, eine Rechnung einzureichen, oder soll ich sie selbst zahlen, um meine Beitragsrückerstattungs-Staffel nicht zu unterbrechen?**

Die relevanten Variablen:

| Variable | Quelle |
|---|---|
| $$R$$ | Erstattungsbetrag der Rechnung (eligible_amount) |
| $$S$$ | Verbleibender Selbstbehalt im Kalenderjahr |
| $$B_n$$ | BRE bei Leistungsfreiheit noch n Monate (aus bre_structure) |
| $$P$$ | Monatlicher Beitrag |
| $$i$$ | Diskontierungsrate (Standard: 3% p.a.) |
| $$\text{Steuervorteil}(R)$$ | Steuerersparnis bei Selbstzahlung — extern berechnet und in die Engine injiziert (Default 0), siehe unten |

**Entscheidungsregel:**

Einreichen lohnt sich, wenn:

$$ R - S > \text{NPV}(\Delta \text{BRE}) + \text{Steuervorteil}(R) $$

wobei $$\text{NPV}(\Delta \text{BRE})$$ der Kapitalwert des entgehenden BRE-Vorteils durch die Unterbrechung der Leistungsfreiheits-Staffel ist [^9]. Sowohl der BRE-Verlust als auch der Steuervorteil sind Vorteile, die nur bei **Selbstzahlung** anfallen; beide erhöhen daher die Schwelle für das Einreichen und stehen auf derselben Seite der Ungleichung.

**Steuervorteil — nicht in der Engine geschätzt:** Selbst gezahlte Arztrechnungen sind nur als **außergewöhnliche Belastungen (§33 EStG)** absetzbar, und auch nur der Teil **oberhalb der zumutbaren Belastung** — einer einkommensabhängigen, über das Jahr kumulierten Schwelle (≈ 1–7 % des Gesamtbetrags der Einkünfte, gestaffelt nach Familienstand und Kinderzahl), die eine einzelne Rechnung selten überschreitet. Eine korrekte Berechnung braucht Einkommen, Veranlagungsart, Kinderzahl und die bereits selbst getragenen Jahreskosten; die Günstigerprüfung-Engine berechnet den Wert daher **nicht** selbst, sondern erhält ihn vom Aufrufer (`taxSavingFromSelfPay`, Default `0` — kein erfundener Vorteil). Ein eigener §33-Helfer liefert den Wert später (Folge-Issue).

### 5.3 Implementierung

```typescript
// guenstiger-pruefung.ts

interface GCP_Input {
  erstattungsBetrag: number;       // Was die PKV erstatten würde
  verbleibenderSelbstbehalt: number;  // Noch offener Selbstbehalt dieses Jahr
  breStructure: BREStructure;
  monthlyPremium: number;
  taxSavingFromSelfPay?: number;   // Steuervorteil (§33 EStG), extern berechnet; Default 0
  discountRate?: number;           // Default: 0.03
  asOf?: Date | string;            // Stichtag; injizierbar (kein verstecktes Date.now())
}

interface GCP_Result {
  recommendation: 'einreichen' | 'selbst_zahlen';
  netBenefitOfSubmitting: number;  // > 0 = Einreichen lohnt; ≤ 0 = selbst zahlen
  breakdown: {
    refundAfterDeductible: number;  // max(0, R − S)
    currentStreakMonths: number;    // aktuelle leistungsfreie Monate
    projectedBRELoss: number;       // unabgezinster BRE-Verlust (Worst Case)
    monthsToYearEnd: number;        // Monate bis Jahresende (Abzinsungsdauer)
    discountRate: number;           // angewandte Diskontrate
    lostBREValue_NPV: number;       // abgezinster BRE-Verlust
    taxSavingFromSelfPay: number;   // Steuervorteil bei Selbstzahlung
  };
  explanation: string;              // deutscher Klartext
}

function calculateGCP(input: GCP_Input): GCP_Result {
  const {
    erstattungsBetrag,
    verbleibenderSelbstbehalt,
    breStructure,
    monthlyPremium,
    taxSavingFromSelfPay = 0,
    discountRate = 0.03,
    asOf = new Date(),
  } = input;

  // Nettoerstattung nach Selbstbehalt
  const refundAfterDeductible = Math.max(0, erstattungsBetrag - verbleibenderSelbstbehalt);

  // BRE-Verlust durch Unterbrechung der Staffel (Stichtag injizierbar)
  const currentStreak = getCurrentStreakMonths(breStructure, asOf);
  const potentialBRE = getProjectedBRE(breStructure, monthlyPremium, asOf);
  const lostBRE = potentialBRE; // Worst case: Staffel auf 0 zurückgesetzt

  // Abzinsung des BRE-Wertes auf heute (er wird erst am Jahresende ausgezahlt)
  const monthsToYearEnd = 12 - asOf.getMonth();
  const lostBREValue_NPV = lostBRE / Math.pow(1 + discountRate / 12, monthsToYearEnd);

  // Steuervorteil: vom Aufrufer geliefert (§33 EStG, Default 0 — siehe §5.1). Er
  // entsteht NUR bei Selbstzahlung und ist damit – wie der BRE-Verlust – ein
  // Kostenfaktor des Einreichens (vgl. Entscheidungsregel §5.1).
  const netBenefitOfSubmitting = refundAfterDeductible - lostBREValue_NPV - taxSavingFromSelfPay;

  return {
    recommendation: netBenefitOfSubmitting > 0 ? 'einreichen' : 'selbst_zahlen',
    netBenefitOfSubmitting,
    breakdown: {
      refundAfterDeductible,
      currentStreakMonths: currentStreak,
      projectedBRELoss: lostBRE,
      monthsToYearEnd,
      discountRate,
      lostBREValue_NPV,
      taxSavingFromSelfPay,
    },
    explanation: buildExplanation(netBenefitOfSubmitting, refundAfterDeductible, lostBREValue_NPV),
  };
}
```

### 5.4 Benutzeroberfläche der Günstigerprüfung

Die Günstigerprüfung wird als interaktiver Card-Screen direkt nach dem Rechnungsscan angezeigt:

```
┌─────────────────────────────────────────┐
│  💡 Günstigerprüfung                    │
│─────────────────────────────────────────│
│  Rechnung: Dr. Müller          85,00 €  │
│  Erstattung PKV (est.):        62,50 €  │
│  Verbl. Selbstbehalt:         150,00 €  │
│  Nettoerstattung:               0,00 €  │
│─────────────────────────────────────────│
│  Aktuelle BRE-Staffel:     11 Monate   │
│  Drohender BRE-Verlust:   185,00 €     │
│  NPV BRE-Verlust:         181,40 €     │
│─────────────────────────────────────────│
│  ✅ Empfehlung: SELBST ZAHLEN           │
│  Vorteil ggü. Einreichen: ~181 €        │
│─────────────────────────────────────────│
│  [Trotzdem einreichen]  [Selbst zahlen] │
└─────────────────────────────────────────┘
```

***

## 6. Frontend-Struktur (SvelteKit PWA)

### 6.1 Seitenstruktur / Routing

```
/                       → Dashboard (Übersicht, offene Rechnungen, BRE-Status)
/contracts              → Vertragsliste
/contracts/[id]         → Vertragsdetail + BRE-Jahresverlauf
/contracts/new          → Neuer Vertrag
/invoices               → Rechnungsarchiv (Filter, Suche)
/invoices/scan          → Rechnungsscan-Flow (Kamera / Datei-Upload)
/invoices/[id]          → Rechnungsdetail + Positionen + Günstigerprüfung
/invoices/[id]/submit   → Einreichungsformular
/stats                  → Jahresauswertung (Kosten, Erstattungen, BRE)
/settings               → Server-URL, Steuersatz, Diskontrate, Datenbankexport
```

### 6.2 Kern-Komponenten

| Komponente | Datei | Zweck |
|---|---|---|
| `OCRScanner` | `lib/components/OCRScanner.svelte` | Kamera-Aufnahme + PaddleOCR-Aufruf |
| `InvoiceReview` | `lib/components/InvoiceReview.svelte` | Parsed Rechnung anzeigen + manuell korrigieren |
| `GCPCard` | `lib/components/GCPCard.svelte` | Günstigerprüfungs-Ergebnis-Karte |
| `ContractCard` | `lib/components/ContractCard.svelte` | Vertragszusammenfassung |
| `BRETracker` | `lib/components/BRETracker.svelte` | BRE-Staffel-Fortschrittsanzeige |
| `InvoiceBadge` | `lib/components/InvoiceBadge.svelte` | Status-Badge für Rechnungen |

### 6.3 PWA-Konfiguration

```json
// app.webmanifest
{
  "name": "PKV Manager",
  "short_name": "PKV",
  "description": "Private Krankenversicherung selbst verwalten",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "categories": ["health", "finance"],
  "lang": "de-DE"
}
```

Service Worker Strategie:
- **Shell-Dateien** (App-Code, GOÄ-Tabelle): Cache First
- **API-Aufrufe** (REST): Network First mit Offline-Queue für Schreiboperationen
- **OCR-Modell** (PaddleOCR ONNX): Cache After First Load (~50–100 MB)

***

## 7. Backend API

### 7.1 REST-Endpunkte

```
GET    /api/persons                   → Alle Personen
POST   /api/persons                   → Neue Person anlegen
GET    /api/persons/:id               → Persondetail
PUT    /api/persons/:id               → Person aktualisieren
DELETE /api/persons/:id               → Person löschen

GET    /api/contracts                 → Alle Verträge
POST   /api/contracts                 → Neuen Vertrag anlegen (mit Versicherungsnehmer)
GET    /api/contracts/:id             → Vertragsdetail inkl. versicherter Personen
PUT    /api/contracts/:id             → Vertrag aktualisieren
DELETE /api/contracts/:id             → Vertrag löschen

GET    /api/contracts/:id/insured     → Versicherte Personen eines Vertrags
POST   /api/contracts/:id/insured     → Versicherte Person hinzufügen (mit KVNR, Tarif, SB, BRE)
GET    /api/insured/:id               → Detail einer versicherten Person
PUT    /api/insured/:id               → Versicherte Person aktualisieren
DELETE /api/insured/:id               → Versicherte Person entfernen

GET    /api/invoices                  → Alle Rechnungen (mit Filter-Query-Params)
POST   /api/invoices                  → Neue Rechnung speichern
GET    /api/invoices/:id              → Rechnungsdetail inkl. Positionen
PUT    /api/invoices/:id              → Rechnung aktualisieren
DELETE /api/invoices/:id              → Rechnung löschen

POST   /api/invoices/:id/submit       → Einreichung erfassen
PUT    /api/invoices/:id/refund       → Erstattungseingang erfassen

GET    /api/stats/year/:year          → Jahresauswertung
GET    /api/stats/bre/:insuredPersonId → BRE-Verlauf einer versicherten Person

GET    /api/export/db                 → SQLite-Datenbank-Download (für Backup)
POST   /api/import/db                 → Datenbank-Wiederherstellung
```

### 7.2 Authentifizierung

Da die App im Heimnetz betrieben wird, ist eine einfache Lösung ausreichend:

- **Primär:** HTTP Basic Auth über nginx/Traefik Reverse Proxy (keine App-eigene Auth nötig)
- **Optional:** Single Token-basierte Auth im Backend (`X-API-Key` Header) für externen Zugriff via Tailscale
- **HTTPS:** Pflicht – Let's Encrypt via Traefik oder selbstsigniertes Zertifikat im LAN

### 7.3 Docker Compose

```yaml
# docker-compose.yml
version: '3.9'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    environment:
      - PUBLIC_API_URL=http://backend:8080
    ports:
      - "3000:3000"
    depends_on:
      - backend

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    volumes:
      - ./data/db:/app/db        # SQLite-Datei persistent
      - ./data/files:/app/files  # Rechnungs-PDFs optional
    environment:
      - DATABASE_PATH=/app/db/pkv.sqlite
      - API_KEY=${PKV_API_KEY}
    ports:
      - "8080:8080"
    restart: unless-stopped

volumes:
  db_data:
  files_data:
```

***

## 8. Sicherheit & Datenschutz

### 8.1 Datenschutz-Architektur

| Datenkategorie | Verarbeitungsort | Begründung |
|---|---|---|
| Rechnungsbilder (Fotos/Scans) | **Nur Client** | Verlassen Gerät nie – OCR läuft im Browser [^6][^10] |
| OCR-Rohtxt | Client → optional Backend | Kann für Debugging gespeichert werden (opt-in) |
| Strukturierte Rechnungsdaten (JSON) | Backend (SQLite) | Keine Bilder, nur Metadaten |
| GOÄ-Ziffern & Beträge | Backend (SQLite) | Kein direkter Gesundheitsbezug |
| Vertragsangaben | Backend (SQLite) | Vertragsdaten, kein Art.-9-Bezug |

### 8.2 DSGVO-relevante Maßnahmen

- **Datenminimierung:** Rechnungsbilder werden nach OCR client-seitig verworfen (kein Upload), sofern Nutzer nicht explizit "Datei speichern" wählt
- **Löschbarkeit:** Jede Entität hat einen `DELETE`-Endpunkt; Datenbank-Export für Portabilität (Art. 20 DSGVO)
- **Verschlüsselung at rest:** Optional SQLCipher für verschlüsselte SQLite-Datenbank
- **Keine Drittanbieter-Abhängigkeiten:** Kein Analytics, kein CDN-Loading von externen Ressourcen

***

## 9. Implementierungs-Roadmap

### Phase 1: MVP (Core-Funktionalität)

- [ ] Monorepo-Setup (pnpm workspaces: `frontend/`, `backend/`)
- [ ] Datenbankschema mit Drizzle ORM implementieren
- [ ] REST-API Endpunkte für Contracts und Invoices
- [ ] SvelteKit-Grundgerüst mit Routing
- [ ] Vertragsverwaltung UI (CRUD)
- [ ] Manuelle Rechnungserfassung (ohne OCR)
- [ ] Günstigerprüfungs-Formel implementieren
- [ ] Docker Compose Setup

### Phase 2: OCR-Integration

- [ ] PaddleOCR.js 3.5 als Web Worker einbinden
- [ ] WebGPU-Verfügbarkeitsprüfung + WASM-Fallback
- [ ] GOÄ-Lookup-Tabelle (JSON) aufbauen (GOÄ + GOZ)
- [ ] OCR-Pipeline: Scan → Parse → Review-Screen
- [ ] Steigerungsfaktor-Validierung

### Phase 3: PWA & Polish

- [ ] Service Worker + Offline-Fähigkeit
- [ ] Web App Manifest + Icons
- [ ] Push Notification für Erstattungseingänge (optional)
- [ ] Jahresauswertungs-Statistiken
- [ ] CSV/PDF-Export für Steuererklärung
- [ ] Datenbank-Import/Export

### Phase 4: Erweiterungen

- [ ] Mehrbenutzer-Support (Familienmitglieder)
- [ ] Beihilfe-Unterstützung (öffentlicher Dienst)
- [ ] Optionaler API-Call an externes LLM für schwer lesbare Handschriften (Opt-in)
- [ ] n8n-Integration für automatische Einreichungs-E-Mails

***

## 10. Offene Fragen & Einschränkungen

| Thema | Status | Anmerkung |
|---|---|---|
| GOÄ-Reform 2025 | ⚠️ Prüfen | Die GOÄ-Reform wurde mehrfach verschoben; aktuelle Fassung von 1996 gilt noch |
| UV-GOÄ / BG-Rechnungen | ❌ Not in Scope v1 | Separates Regelwerk für Arbeitsunfälle |
| Auslandsbehandlungen | ❌ Not in Scope v1 | Keine EHI-Gebührentabellen-Prüfung |
| OCR Handschrift | ⚠️ Limitiert | PP-OCRv5 begrenzt bei Handschrift – Fallback auf manuelle Eingabe |
| PaddleOCR.js Lizenz | ✅ OK | Apache 2.0 [^6] |
| SvelteKit Lizenz | ✅ OK | MIT |

***

## Anhang A: Verzeichnisstruktur

```
pkv-manager/
├── docker-compose.yml
├── .env.example
├── frontend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte              (Dashboard)
│   │   │   ├── contracts/
│   │   │   │   ├── +page.svelte
│   │   │   │   ├── new/+page.svelte
│   │   │   │   └── [id]/+page.svelte
│   │   │   ├── invoices/
│   │   │   │   ├── +page.svelte
│   │   │   │   ├── scan/+page.svelte
│   │   │   │   └── [id]/+page.svelte
│   │   │   └── stats/+page.svelte
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   ├── workers/
│   │   │   │   └── ocr.worker.ts
│   │   │   ├── utils/
│   │   │   │   ├── goae-parser.ts
│   │   │   │   └── guenstiger-pruefung.ts
│   │   │   └── data/
│   │   │       ├── goae-2024.json
│   │   │       └── goz-2024.json
│   │   └── app.webmanifest
│   ├── static/
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── index.ts                      (Hono App Entry)
│   │   ├── routes/
│   │   │   ├── contracts.ts
│   │   │   ├── invoices.ts
│   │   │   └── stats.ts
│   │   ├── db/
│   │   │   ├── schema.ts                 (Drizzle Schema)
│   │   │   └── migrations/
│   │   └── middleware/
│   │       └── auth.ts
│   └── package.json
└── docs/
    └── design.md                         (dieses Dokument)
```

## Anhang B: Empfohlene NPM-Pakete

| Paket | Version | Zweck |
|---|---|---|
| `@paddle-js-models/ocr` | ^3.5 | PaddleOCR.js Browser-OCR [^6] |
| `@hono/hono` | ^4.x | Backend-Framework |
| `drizzle-orm` | ^0.30 | Type-safe ORM für SQLite |
| `better-sqlite3` | ^9.x | SQLite Node.js Bindings |
| `svelte` | ^5.x | Frontend Framework |
| `@sveltejs/kit` | ^2.x | Full-stack Framework |
| `vite-plugin-pwa` | ^0.20 | Service Worker + PWA-Manifest |
| `zod` | ^3.x | Schema-Validierung (API + Forms) |
| `date-fns` | ^3.x | Datumsberechnungen (BRE-Staffel) |

---

## References

1. [PKV Go - App Store - Apple](https://apps.apple.com/de/app/pkv-go/id6760260292) - Behalte den Überblick über deine PKV-Rechnungen, erkenne Vorsorgeleistungen automatisch und maximier...

2. [RechnungsDoc Mobil - Applicay Software Development](https://applicay.com/rechnungsdoc_mobil/) - Arztrechnungen direkt nach dem Arztbesuch erfassen mit iPhone oder iPad. Optimiert für PKV und Beihi...

3. [PKV Go – Dein PKV-Sparassistent](https://pkvgo.com) - Maximiere deine Beitragsrückerstattung. Arztrechnungen scannen, Sparpotenzial erkennen, mehr Geld zu...

4. [GitHub - haube/pkv-rechnung: small app for gathering and tracking medical invoices, learning vue and typescript](https://github.com/haube/pkv-rechnung) - small app for gathering and tracking medical invoices, learning vue and typescript - haube/pkv-rechn...

5. [Baidu PaddleOCR 3.5 Launches with Browser OCR, Markdown ... - KuCoin](https://www.kucoin.com/news/flash/baidu-paddleocr-3-5-launches-with-browser-ocr-markdown-conversion-and-transformers-backend) - ME News reports that on April 23 (UTC+8), according to monitoring by Beating, Baidu's PaddlePaddle o...

6. [Deterministic OCR in JavaScript: PaddleOCR for Node, Bun, Deno ...](https://dev.to/awalariansyah/deterministic-ocr-in-javascript-paddleocr-for-node-bun-deno-and-the-browser-2bgn) - A fast, lightweight PaddleOCR SDK that runs in every JavaScript runtime. Built on PP-OCRv5 and ONNX ...

7. [Browser-Native LLM Inference: The WebGPU Engineering You Didn ...](https://tianpan.co/blog/2026-04-17-browser-native-llm-inference-webgpu) - Running LLMs directly in the browser via WebGPU changes your entire application architecture. Here's...

8. [Rechnungen lokal per OCR &amp; Vision-LLM auslesen](https://s-edv.com/anleitungen/dokumenten-extraktion-lokal-rechnungen-vision-llm-ocr) - DSGVO-konformer KMU-Workflow: Rechnungen und Belege lokal mit PaddleOCR, Docling und Qwen2.5-VL zu J...

9. [PKV: Kosten abrechnen oder rückerstatten? - Über – Nico Litschke](https://www.nicolitschke.com/texte/pkv-npv-rueckerstattung.html) - Kapitalwert-Analyse: Lohnt sich bei meiner PKV die Rückerstattung oder die Kostenabrechnung? Praxisn...

10. [WebGPU Inference: LLMs That Run in Your Browser - Medium](https://medium.com/@bhagyarana80/webgpu-inference-llms-that-run-in-your-browser-6251d27a0565) - A practical guide to shipping a privacy-first, zero-ops language model that runs entirely on the use...

