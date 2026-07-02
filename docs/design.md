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
| **OCR Engine** | PP-OCRv5 via `ppu-paddle-ocr` (ONNX Runtime) | Browser-native, WebGPU + WASM Fallback, Web-Worker-tauglich, kein Server [^6] |
| **AI-Beschleunigung** | WebGPU API (Chrome/Edge) + WebNN (Android NPU) | Standard in Chrome seit 2025, ~82% Browser-Coverage [^7] |
| **Fallback OCR** | WASM-Execution-Provider (ONNX Runtime) | Wenn kein WebGPU verfügbar |
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
included_benefits     TEXT                   -- JSON: Objekt { benefits: [...] } der enthaltenen Leistungen
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
    { "claim_free_years": 1, "bre_years": 1, "pct_of_premium": 100 },
    { "claim_free_years": 2, "bre_years": 2, "pct_of_premium": 100 },
    { "claim_free_years": 3, "bre_years": 3, "pct_of_premium": 100 }
  ],
  "current_streak_start": "2024-01-01"
}
```

Jede Stufe (`level`) bindet eine Anzahl **leistungsfreier Kalenderjahre** (`claim_free_years`) an
eine Rückerstattung — entweder im Prozent-Modus (`bre_years × Monatsbeitrag × pct_of_premium / 100`)
oder als Festbetrag (`fixed_amount_eur`). `current_streak_start` ist der Beginn der aktuell
laufenden leistungsfreien Strähne (ISO `YYYY-MM-TT`).

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

Die Summen-Felder der Rechnung (`eligible_amount`, `self_paid_amount`) sind **abgeleitet** und
werden ausschließlich aus den Positionen neu berechnet (read-only in der API, bei jeder
Positionsänderung aktualisiert). Quelle der Wahrheit für Erstattungsfähigkeit und tatsächliche
Erstattung sind die **Positionen** — denn das für BRE/Selbstbehalt maßgebliche Leistungsjahr hängt
am `treatment_date` der Position, nicht an der Rechnung (§5.2). `total_amount` bleibt der erfasste
Kopfbetrag der Rechnung (Abgleich gegen Σ `charged_amount`).

```sql
id                TEXT PRIMARY KEY
insured_person_id TEXT REFERENCES insured_persons(id)  -- welche versicherte Person die Rechnung betrifft
invoice_date      DATE NOT NULL        -- Ausstellungsdatum der Rechnung (NICHT BRE-relevant, siehe §5.2)
invoice_number    TEXT
provider_name     TEXT NOT NULL        -- Name des Arztes / der Einrichtung
provider_type     TEXT                 -- 'arzt' | 'zahnarzt' | 'krankenhaus' | 'sonstiges'
total_amount      REAL NOT NULL        -- Rechnungsbetrag brutto in EUR (erfasster Kopfbetrag)
eligible_amount   REAL                 -- ABGELEITET: Σ positions.eligible_amount (read-only)
self_paid_amount  REAL DEFAULT 0       -- ABGELEITET: selbst getragener Anteil aus den Positionen (read-only)
status            TEXT DEFAULT 'neu'   -- 'neu' | 'geprüft' | 'bezahlt' | 'eingereicht' | 'erstattet'
file_path         TEXT                 -- Pfad zur gespeicherten PDF/Bild-Datei (optional)
ocr_raw           TEXT                 -- Roh-OCR-Text (für Debugging)
notes             TEXT
created_at        DATETIME
```

**Status-Workflow (Zustandsmaschine):**

```
neu ↔ geprüft → bezahlt → eingereicht → erstattet
```

- **`neu`/`geprüft`** — bearbeitbar; in der Günstigerprüfung wird **nur `neu` ignoriert**.
- **`bezahlt`** — die Rechnung wurde beglichen; eine Einreichungsentscheidung ist damit *noch nicht*
  getroffen. **Ab `bezahlt` ist die Rechnung gesperrt** (nicht mehr editierbar).
- **„Selbst zahlen"** ist *kein* eigener Status, sondern eine Rechnung, die auf `bezahlt` stehen
  bleibt und nie eingereicht wird.
- **`eingereicht`** — bei der PKV eingereicht.
- **`erstattet`** — von der PKV bearbeitet; der **tatsächliche Erstattungsbetrag wird je Position**
  erfasst (`positions.refund_amount`). **„Abgelehnt"** ist *kein* eigener Status, sondern
  `erstattet` mit `refund_amount = 0`.
- Jeder Statuswechsel wird mit Zeitstempel in `invoice_status_events` protokolliert (s. u.).

#### `invoice_positions`

Trägt sowohl den **geschätzten** erstattungsfähigen Betrag (`eligible_amount`, aus der
Erstattungs-Engine §5.1) als auch den **tatsächlichen** Erstattungsbetrag (`refund_amount`, erfasst
beim Übergang nach `erstattet`). Das **`treatment_date` (Leistungsdatum) ist Pflicht** — es ordnet
die Position ihrem BRE-/Selbstbehalt-Jahr zu (§5.2). Eine Sammelrechnung kann Positionen aus
mehreren Leistungsjahren enthalten.

```sql
id               TEXT PRIMARY KEY
invoice_id       TEXT REFERENCES invoices(id)
treatment_date   DATE NOT NULL      -- Leistungsdatum; bestimmt das BRE-/Selbstbehalt-Jahr (§5.2)
goae_number      TEXT NOT NULL      -- GOÄ-Ziffer, z.B. "0340"
goae_category    TEXT               -- 'GOÄ' | 'GOZ' | 'GOT' | 'Auslagenersatz'
description      TEXT               -- Leistungsbeschreibung aus GOÄ-Lookup
quantity         INTEGER DEFAULT 1  -- Anzahl
multiplier       REAL NOT NULL      -- Steigerungsfaktor, z.B. 2.3
base_amount      REAL NOT NULL      -- 1-facher Betrag laut GOÄ
charged_amount   REAL NOT NULL      -- In Rechnung gestellter Betrag
eligible_amount  REAL               -- Geschätzt erstattungsfähig (Erstattungs-Engine, §5.1)
refund_amount    REAL               -- Tatsächlich erstattet (erfasst bei Status 'erstattet'); 0 = abgelehnt
is_valid         BOOLEAN            -- Steigerungsfaktor innerhalb Regelgrenze?
flag_reason      TEXT               -- Begründung bei Auffälligkeit
```

`goae_category` trägt neben den drei Gebührenordnungen zusätzlich den Wert
**`Auslagenersatz`** für §10 GOÄ — typischerweise Porto-/Versandkosten, die zum tatsächlichen
Betrag statt zu einem GOÄ-Satz abgerechnet werden. Der GOÄ-Parser erkennt Auslagenersatz-
Schlüsselwörter (Porto, Versand, Verpackung, Postgebühr, …) in der Beschreibung und setzt die
Kategorie beim Einlesen automatisch; sie bleibt in der UI jederzeit manuell auf einen der anderen
Werte umstellbar. Positionen mit `goae_category = 'Auslagenersatz'` durchlaufen keine
Ziffer-/Steigerungsfaktor-Prüfung gegen ein Gebührenverzeichnis (`is_valid = true` ohne Lookup) und
werden in der Erstattungs-Engine **stets zu 100 % von `charged_amount`** erstattet — unabhängig von
Tarifstufen, Wartezeit, Beihilfe-Quote oder Summengrenzen (§5.1).

#### `invoice_status_events`

Protokolliert jeden Statuswechsel einer Rechnung mit Zeitstempel — eine eigene Tabelle (statt
fixer `*_at`-Spalten), damit sich der Workflow künftig ohne Schema-Bruch erweitern lässt.

```sql
id               TEXT PRIMARY KEY
invoice_id       TEXT REFERENCES invoices(id)
status           TEXT NOT NULL        -- der neue Status ('neu' | 'geprüft' | 'bezahlt' | 'eingereicht' | 'erstattet')
changed_at       DATETIME NOT NULL    -- Zeitpunkt des Wechsels
note             TEXT                 -- optionale Notiz
```

#### `submissions`

Hält die Einreichungs-Metadaten. Der **tatsächliche Erstattungsbetrag liegt je Position**
(`invoice_positions.refund_amount`); `submissions` führt deshalb keinen aggregierten Erstattungs-
oder Ablehnungsbetrag mehr.

```sql
id               TEXT PRIMARY KEY
invoice_id       TEXT REFERENCES invoices(id)
submitted_at     DATETIME
submitted_via    TEXT          -- 'app' | 'post' | 'email'
expected_refund  REAL          -- Erwartete Erstattung (Schätzung zum Einreichungszeitpunkt)
refund_date      DATE          -- Datum des Erstattungseingangs
```

#### `bre_periods`
```sql
id                TEXT PRIMARY KEY
insured_person_id TEXT REFERENCES insured_persons(id)
year              INTEGER NOT NULL
streak_years      INTEGER DEFAULT 0    -- Leistungsfreie Jahre
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
3. PP-OCRv5 (`ppu-paddle-ocr`, ONNX Runtime, WebGPU/WASM):
   - Texterkennung → Array von { text, bbox, confidence }
        ↓
4. GOÄ-Strukturparser:
   - Regex-Extraktion der Rechnungsfelder
   - GOÄ-Ziffer-Lookup
   - Validierung
        ↓
5. Ergebnis-JSON → Review-Screen → bei Bestätigung: API POST
```

### 4.2 PP-OCRv5-Integration (`ppu-paddle-ocr`)

PP-OCRv5 läuft im Browser über die `ppu-paddle-ocr`-Bindung (MIT) auf **ONNX
Runtime**: WebGPU mit automatischem WASM-Fallback, lauffähig im **Web Worker**
und mit einem {@link ImageData}-Frame als Eingabe — kein DOM-`HTMLImageElement`
nötig [^6]. (Das ältere offizielle `@paddle-js-models/ocr` schied aus: WebGL-
statt WebGPU-gebunden, DOM-/opencv-gebunden und damit nicht Worker-tauglich, und
kein echtes PP-OCRv5.)

Die Bindung sitzt hinter einem schmalen, injizierbaren Adapter-Seam
(`apps/frontend/src/lib/ocr/engine.ts`, `createPaddleOcrEngine`), den der Worker
(`apps/frontend/src/lib/workers/ocr.worker.ts`) ansteuert. Der Adapter setzt drei
Dinge explizit:

```typescript
// apps/frontend/src/lib/ocr/engine.ts (Auszug — vom OCR-Web-Worker angesteuert)
import { PaddleOcrService } from 'ppu-paddle-ocr/web';

const service = new PaddleOcrService({
  // Immer lokale, gleich­ursprüngliche Modell-URLs — NIE die CDN-Defaults der
  // Bindung (Privacy, §1.3/§8). Hosting: apps/frontend/static/models/ocr/.
  model: {
    detection: '/models/ocr/det.onnx',
    recognition: '/models/ocr/rec.onnx',
    charactersDictionary: '/models/ocr/dict.txt',
  },
  // Backend-Wahl (WebGPU bevorzugt, sonst WASM) → ONNX-Execution-Provider.
  session: { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' },
  // Worker-tauglicher Bildpfad ohne DOM-gebundenes opencv.
  processing: { engine: 'canvas-native' },
});
await service.initialize();
const { lines } = await service.recognize(imageData); // [{ text, box, score }]
```

**Wichtig:** OCR läuft in einem **Web Worker**, damit der UI-Thread während der
Verarbeitung nicht blockiert. Die schweren Laufzeit-Assets (ONNX-Runtime-WASM
und die ~12 MB Modelldateien) werden **lokal** ausgeliefert und vom Service
Worker beim ersten Gebrauch gecacht (§6.3); kein Drittanbieter-Abruf zur
Laufzeit.

### 4.3 GOÄ-Strukturparser

Arztrechnungen nach §12 GOÄ folgen einem gesetzlich definierten Schema. Der
Parser (`apps/frontend/src/lib/utils/goae-parser.ts`) ist reiner, deterministischer
Code (kein LLM) und die **Konsumentenseite** des `fee-schedule/v1`-Formats
(siehe `docs/data-format.md`, `apps/frontend/src/lib/data/fee-schedule.ts`). Er
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
   Auslagenersatz nach §10 GOÄ (Porto/Versand etc.) hat keine Ziffer, gegen
   die dieser Schritt prüfen könnte: der exportierte reine Helfer
   `isAuslagenersatzDescription` (Schlüsselwort-Erkennung in der
   Beschreibung) wird stattdessen vom Aufrufer (Review-UI, `scan-flow.ts`)
   genutzt, um `goae_category` auf `'Auslagenersatz'` zu setzen und die
   Position so komplett vom Tabellen-Lookup auszunehmen — `lookupPosition`
   selbst kennt diesen Wert nicht (s. §5.1 zur Erstattung).
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
  isAuslagenersatz?: boolean;       // goae_category === 'Auslagenersatz' (§10 GOÄ); überspringt die Pipeline unten komplett
}

interface ErstattungInput {
  positions: ErstattungPosition[];  // aus dem GOÄ-Parser (charged_amount, benefitCategory)
  benefits: IncludedBenefits;       // included_benefits der versicherten Person
  invoiceDate: Date | string;       // für Wartezeit-/Aufbaujahres-Prüfung (injizierbar)
  coverageStart: Date | string;     // Beginn des Versicherungsschutzes der Person (insured_persons.start_date)
  patientAge?: number;              // Alter bei Leistungsdatum (treatment_date), für altersabhängige limits
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

**Attribution je Position:** Die Engine kappt zwar je Kategorie-Gruppe, muss die erstattungsfähige
Summe aber **auf die einzelnen Positionen zurückverteilen** (→ `invoice_positions.eligible_amount`),
weil die Günstigerprüfung pro **Leistungsjahr** aggregiert (§5.2) und Positionen derselben Kategorie
in unterschiedliche Leistungsjahre fallen können. Verteilungsregel: **anteilig nach
`charged_amount`** innerhalb der Kategorie. Da `annual_staffel`/`jahr`-Limits ohnehin policenjahres-
bezogen sind, wird `priorClaimsByCategory` aus den bereits erfassten Positionen des relevanten Jahres
gespeist. Altersabhängige `limits` beziehen sich auf das **`treatment_date`** der Position, nicht auf
das Rechnungsdatum.

Das Ergebnis (`eligibleAmount` gesamt bzw. je Position) fließt als `erstattungsBetrag` (= $$R$$) in
die Günstigerprüfung (§5.2/§5.3) ein — dort aggregiert pro versicherter Person und Leistungsjahr.

**Auslagenersatz nach §10 GOÄ** (`goae_category === 'Auslagenersatz'` → `isAuslagenersatz: true`,
typischerweise Porto-/Versandkosten): diese Positionen überspringen die fünfstufige Pipeline oben
vollständig und werden **stets zu 100 % von `chargedAmount`** erstattet — unabhängig von Wartezeit,
Schwellen-Staffel, Beihilfe-Quote oder Summengrenzen. Sie fließen in `auslagenersatzAmount` (separat
von `byCategory`) und summieren sich mit in `eligibleAmount` ein. `goae_category` wird beim Einlesen
automatisch aus der Positionsbeschreibung erkannt (§4.3, `isAuslagenersatzDescription`) und bleibt in
der UI über das bestehende Kat.-Dropdown manuell setzbar.

### 5.2 Entscheidungslogik

Die Günstigerprüfung beantwortet: **Lohnt es sich, die Arztrechnungen einzureichen, oder soll ich sie selbst zahlen, um meine Beitragsrückerstattungs-Staffel nicht zu unterbrechen?**

#### 5.2.1 Aggregationseinheit: versicherte Person × Leistungsjahr

Die Entscheidung fällt **nicht pro Rechnung**, sondern pro **versicherter Person und Leistungsjahr**.
Drei Eigenschaften der PKV erzwingen das:

1. **Der Selbstbehalt ist eine Jahresgröße.** Erstattet wird nur, was die *kumulierte*
   erstattungsfähige Summe eines Jahres über den Selbstbehalt hinaus übersteigt — nicht jede
   Rechnung für sich.
2. **Der BRE-Verlust fällt pro Jahr genau einmal an.** Einreichen *an sich* bricht die Staffel
   nicht — erst eine **tatsächlich ausgezahlte Erstattung** (d. h. wenn die Jahressumme den
   Selbstbehalt reißt). Unterhalb des Selbstbehalts ist Einreichen folgenlos.
3. **Das maßgebliche Jahr ist das Leistungsjahr der Position (`treatment_date`), nicht das
   Rechnungs- oder Einreichungsdatum.** Eine im Januar gestellte Rechnung mit Dezember-Leistungen
   des Vorjahres betrifft die **Vorjahres**-BRE und den Vorjahres-Selbstbehalt. Eine Sammelrechnung
   kann sich auf mehrere Leistungsjahre verteilen.

Die Aggregation läuft daher über **Positionen, gruppiert nach Leistungsjahr `Y`**, je versicherter
Person, über alle Rechnungen außer im Status `neu`. Der pro Jahr maßgebliche Betrag `R_Y` ist
statusabhängig:

| Rechnungsstatus | Beitrag der Position zu `R_Y` |
|---|---|
| `erstattet` | `refund_amount` (tatsächliche Erstattung; `0` = abgelehnt) |
| `geprüft` / `bezahlt` / `eingereicht` | `eligible_amount` (Schätzung der Erstattungs-Engine §5.1) |
| `neu` | — (ignoriert) |

#### 5.2.2 Variablen

| Variable | Quelle |
|---|---|
| $$R_Y$$ | Summe der maßgeblichen Positionsbeträge mit `treatment_date` in Jahr $$Y$$ (s. Tabelle oben) |
| $$S$$ | Selbstbehalt p.a. der versicherten Person (`self_retention`) |
| $$B(k)$$ | Jahres-BRE bei $$k$$ aufeinanderfolgenden leistungsfreien Jahren (aus `bre_structure`); $$B(0)=0$$ |
| $$s$$ | Aktuelle leistungsfreie Jahre vor $$Y$$ |
| $$n_{\max}$$ | Höchste Staffel-Stufe |
| $$i$$ | Diskontierungsrate (Standard: 3 % p.a.) |
| $$p$$ | Wahrscheinlichkeit, in einem künftigen Jahr leistungsfrei zu bleiben (Standard: 0,7) |
| $$\tau_j$$ | Monate von `asOf` bis zum BRE-Auszahlungstermin des Jahres $$Y+j$$ |
| $$\text{Steuervorteil}$$ | Steuerersparnis bei Selbstzahlung — extern berechnet, injiziert (Default 0), siehe unten |

#### 5.2.3 Entscheidungsregel (All-or-Nothing pro Jahr)

Weil der Staffelbruch ein binäres Jahresereignis ist, ist die Entscheidung pro Jahr binär:
Entweder das Jahr bleibt unter dem Selbstbehalt (alles selbst zahlen, BRE erhalten) — oder die
Schwelle wird überschritten, und dann wird **alles** Erstattungsfähige eingereicht (jeder Euro
oberhalb von $$S$$ wird voll erstattet, der BRE-Verlust fällt nur einmal an).

$$ \max(0,\; R_Y - S) \;>\; \text{NPV}(\Delta \text{BRE}) + \text{Steuervorteil} $$

**Sonderfall „Staffel bereits gebrochen":** Ist für Jahr $$Y$$ bereits eine Erstattung geflossen
(eine Position mit `treatment_date` in $$Y$$ auf einer `erstattet`-Rechnung mit `refund_amount > 0`),
ist die BRE für $$Y$$ versenkt: $$\text{NPV}(\Delta \text{BRE}) = 0$$ ⇒ für $$Y$$ **alles einreichen**.

#### 5.2.4 BRE-Verlust als Differenz zweier abgezinster Ströme

Verglichen werden zwei Zahlungsströme, abgezinst auf den Entscheidungstag `asOf`:

- **Einreichen:** $$R_Y - S$$ fließt **sofort** (≈ keine Abzinsung) → dafür entfällt die BRE für $$Y$$
  und die Staffel fällt auf 0 zurück ($$B(0)=0$$).
- **Selbst zahlen:** die BRE für $$Y$$ wird im **Auszahlungsmonat des Folgejahres** (Standard: Juli
  von $$Y+1$$) zur dann geltenden Staffel ausgezahlt — **und** die Staffel läuft weiter, sodass
  künftige Jahre höhere BREs bringen, bis $$n_{\max}$$ erreicht ist.

Die Kosten des Einreichens sind also die **Differenz beider BRE-Ströme** — nicht nur der eine
Jahresbetrag. Der Selbstzahl-Pfad erreicht am Ende von $$Y+j$$ die Stufe $$\min(s+1+j,\,n_{\max})$$,
der Einreich-Pfad (Reset) nur $$\min(j,\,n_{\max})$$. Abgezinst und mit der Erreichens-
Wahrscheinlichkeit $$p^j$$ gewichtet:

$$ \text{NPV}(\Delta \text{BRE}) = \sum_{j=0}^{n_{\max}-1} \Big[\, B(\min(s{+}1{+}j,\,n_{\max})) - B(\min(j,\,n_{\max})) \,\Big] \cdot p^{\,j} \cdot \frac{1}{(1 + i/12)^{\tau_j}} $$

- **$$j=0$$** — der **sichere** Sofort-Term ($$p^0 = 1$$): $$B(\min(s{+}1,\,n_{\max})) - B(0)$$. Das ist
  die unmittelbar entgehende Jahres-BRE, korrekt auf das **Leistungsjahr** abgezinst.
- **$$j \ge 1$$** — die **Wiederaufstiegs-Transiente**: der Vorsprung, den der Selbstzahl-Pfad in den
  Folgejahren behält, geometrisch mit $$p^j$$ gedämpft (abnehmende Wahrscheinlichkeit, die höheren
  Stufen tatsächlich zu erreichen). Die Summe endet von selbst, sobald beide Pfade $$n_{\max}$$
  erreichen — also nach höchstens $$n_{\max}$$ Termen.

**Abzinsungsziel $$\tau_j$$:** Die BRE für ein Leistungsjahr $$Y$$ wird im **Juli von $$Y+1$$**
ausgezahlt; $$\tau_j$$ ist die Monatsdistanz von `asOf` bis zum Juli von $$Y+1+j$$, mindestens 0
(ist `asOf` bereits nach dem Auszahlungstermin — Entscheidung über ein vergangenes Jahr —, ist der
Verlust sofort/realisiert, keine Abzinsung). Der Auszahlungsmonat ist vorerst fest Juli; ihn pro
Vertrag konfigurierbar zu machen ist ein Folge-Issue.

**Steuervorteil — nicht in der Engine geschätzt:** Selbst gezahlte Arztrechnungen sind nur als **außergewöhnliche Belastungen (§33 EStG)** absetzbar, und auch nur der Teil **oberhalb der zumutbaren Belastung** — einer einkommensabhängigen, über das Jahr kumulierten Schwelle (≈ 1–7 % des Gesamtbetrags der Einkünfte, gestaffelt nach Familienstand und Kinderzahl), die eine einzelne Rechnung selten überschreitet. Eine korrekte Berechnung braucht Einkommen, Veranlagungsart, Kinderzahl und die bereits selbst getragenen Jahreskosten; die Günstigerprüfung-Engine berechnet den Wert daher **nicht** selbst, sondern erhält ihn vom Aufrufer (`taxSavingFromSelfPay`, Default `0` — kein erfundener Vorteil). Ein eigener §33-Helfer liefert den Wert später (Folge-Issue). Da der Selbstbehalt und die Selbstzahl-Summe ohnehin Jahresgrößen sind, gehört auch der Steuervorteil auf Jahresebene.

#### 5.2.5 Rechenbeispiel

Staffel $$B(0..3{+}) = 0 / 200 / 350 / 500\,€$$, Top $$n_{\max}=3$$; aktueller Streak $$s=2$$ (dieses
Jahr wäre Jahr 3 → 500 €). $$i=3\,\%$$, $$p=0{,}7$$, Entscheidung im Juli von $$Y$$ (Auszahlungen
Juli $$Y{+}1$$/$$Y{+}2$$/$$Y{+}3$$, also $$\tau = 12/24/36$$ Monate):

| $$j$$ | Selbstzahl $$B$$ | Reset $$B$$ | Gap | $$\times p^j$$ | $$\times$$ Diskont | Beitrag |
|---|---|---|---|---|---|---|
| 0 | 500 | 0 | 500 | 1,00 | 0,971 | **485 €** |
| 1 | 500 | 200 | 300 | 0,70 | 0,943 | **198 €** |
| 2 | 500 | 350 | 150 | 0,49 | 0,915 | **67 €** |
| 3+ | 500 | 500 | 0 | — | — | 0 |
| | | | | | **Σ** | **≈ 751 €** |

Eine reine Ein-Jahres-Betrachtung sähe nur die 485 € (Zeile $$j=0$$). Der Wiederaufstieg hebt die
Einreich-Schwelle hier auf ~751 € — ökonomisch korrekt, weil das Brechen der Staffel auch das
mehrjährige Hochklettern kostet.

### 5.3 Implementierung

Die Engine arbeitet **pro versicherter Person × Leistungsjahr**. Ein vorgelagerter Aggregations-
Helfer bündelt die Positionen aller Rechnungen (außer `neu`) nach Leistungsjahr und liefert je Jahr
`R_Y` (statusabhängig: tatsächlich erstattet vs. geschätzt) sowie das Flag „bereits gebrochen".

```typescript
// guenstiger-pruefung.ts

interface GCP_YearInput {
  year: number;                    // Leistungsjahr Y
  erstattungsBetrag: number;       // R_Y — aggregiert über Positionen mit treatment_date in Y
  alreadyBroken: boolean;          // Y bereits gebrochen? (Erstattung > 0 für Y bereits geflossen)
  selbstbehalt: number;            // S — Selbstbehalt p.a. der Person (self_retention)
  breStructure: BREStructure;
  monthlyPremium: number;
  taxSavingFromSelfPay?: number;   // Steuervorteil (§33 EStG), extern berechnet; Default 0
  discountRate?: number;           // i — Default: 0.03
  claimFreeProbability?: number;   // p — Default: 0.7
  payoutMonth?: number;            // BRE-Auszahlungsmonat (1–12); Default: 7 (Juli)
  asOf?: Date | string;            // Stichtag; injizierbar (kein verstecktes Date.now())
}

interface GCP_Result {
  recommendation: 'einreichen' | 'selbst_zahlen';
  netBenefitOfSubmitting: number;  // > 0 = Einreichen lohnt; ≤ 0 = selbst zahlen
  breakdown: {
    year: number;
    refundAfterDeductible: number; // max(0, R_Y − S)
    currentStreakYears: number;    // s
    alreadyBroken: boolean;        // war die Staffel für Y schon gebrochen?
    lostBREValue_NPV: number;      // Σ über j (= 0, wenn alreadyBroken)
    ladderTerms: Array<{           // Aufschlüsselung der NPV-Summe (Transparenz/UI)
      j: number;
      gross: number;               // B(min(s+1+j,nMax)) − B(min(j,nMax))
      probability: number;         // p^j
      monthsToPayout: number;      // τ_j
      discounted: number;          // gewichteter, abgezinster Beitrag
    }>;
    discountRate: number;
    claimFreeProbability: number;
    taxSavingFromSelfPay: number;
  };
  explanation: string;             // deutscher Klartext
}

// NPV(ΔBRE): Differenz aus Selbstzahl- und Reset-Pfad, p^j-gedämpft, auf asOf abgezinst.
// Bei alreadyBroken === true ist die BRE für Y bereits versenkt ⇒ NPV = 0.
function calculateGCP(input: GCP_YearInput): GCP_Result { /* … siehe §5.2.4 … */ }
```

Die **Marginalanzeige** auf der Einzelrechnung (§5.4) ist nur eine Sicht auf diese Jahres-Aggregation:
Sie zeigt, was die Rechnung je Leistungsjahr beiträgt und ob das Jahr dadurch die Schwelle reißt —
das eigentliche Verdikt lebt auf der Person-×-Jahr-Ansicht.

### 5.4 Benutzeroberfläche der Günstigerprüfung

Das **Verdikt** lebt auf der **Person-×-Jahr-Ansicht** (§6.1): pro Leistungsjahr eine Karte mit
`R_Y`, Selbstbehalt, Schwellenstatus, NPV(ΔBRE) und der Empfehlung für *alle* Rechnungen dieses
Jahres zusammen. Die einzelne Rechnung zeigt **kein** eigenes Verdikt mehr, sondern nur eine
**Marginalanzeige**: ihren Beitrag je Leistungsjahr und ob das Jahr dadurch die Schwelle reißt.

**Person-×-Jahr-Verdikt (maßgeblich):**

```
┌─────────────────────────────────────────────┐
│  💡 Günstigerprüfung — Max Müller · 2025     │
│───────────────────────────────────────────── │
│  Erstattungsfähig 2025 (R):     1.240,00 €   │
│  Selbstbehalt (S):                500,00 €   │
│  Nettoerstattung max(0, R−S):     740,00 €   │
│───────────────────────────────────────────── │
│  Aktuelle Staffel:               3 Jahre     │
│  NPV BRE-Verlust (inkl. Leiter):  751,00 €   │
│   davon Sofort (j=0):             485,00 €   │
│   davon Wiederaufstieg:           266,00 €   │
│───────────────────────────────────────────── │
│  ⚠️ Knapp: Einreichen +ø, prüfen             │
│  [Alle 2025er einreichen]                    │
└─────────────────────────────────────────────┘
```

**Marginalanzeige auf der Einzelrechnung (kein Verdikt):**

```
┌─────────────────────────────────────────────┐
│  Beitrag dieser Rechnung zur Günstigerprüfung│
│───────────────────────────────────────────── │
│  Leistung 2024:  120,00 €                    │
│   2024: R 480 € / SB 500 € → unter Schwelle  │
│   Staffel sicher                             │
│  Leistung 2025:  310,00 €                    │
│   2025: R 1.240 € / SB 500 € → Schwelle      │
│   gerissen — Einreichen bricht 2025er-Staffel│
│───────────────────────────────────────────── │
│  → volles Verdikt: Max Müller · 2024 / 2025  │
└─────────────────────────────────────────────┘
```

***

## 6. Frontend-Struktur (SvelteKit PWA)

### 6.1 Seitenstruktur / Routing

```
/                       → Dashboard (offene Aktionen, BRE-Schnellstatus — kein Ersatz für Auswertung)
/contracts              → Vertragsliste
/contracts/[id]         → Vertragsdetail + Verwaltung der versicherten Personen
/contracts/new          → Neuer Vertrag
/insured                → Alle versicherten Personen (Top-Level-Einstieg, gruppiert nach Vertrag)
/insured/[id]           → Versicherte Person: BRE-Staffel + Günstigerprüfungs-Verdikt je Leistungsjahr + Rechnungsliste
/invoices               → Rechnungsarchiv (Filter, Suche)
/invoices/new           → Rechnung erfassen (manuell oder via OCR-Scan)
/invoices/[id]          → Rechnungsdetail + Positionen + Status-Workflow + GP-Marginalanzeige
/invoices/[id]/submit   → Einreichungsformular
/persons                → Personen (Versicherungsnehmer und Haushaltsmitglieder als Identitäten)
/persons/[id]           → Personendetail + Bearbeitung
/stats                  → Jahresauswertung (Kosten, Erstattungen, BRE — vollständige Analyse, geplant)
/settings               → Server-URL, Steuersatz, Diskontrate, Leistungsfrei-Wahrscheinlichkeit, Datenbankexport
```

**Informationsarchitektur und Rollentrennung:**

- **Dashboard** (`/`) — offene Aktionen (unbearbeitete / eingereichte Rechnungen) und BRE-Schnellstatus (kompakt, verlinkt auf `/insured/[id]`). Keine vollständige Jahresanalyse — das ist Aufgabe der Auswertung.
- **Auswertung** (`/stats`) — vollständige Jahresanalyse (Kosten, Erstattungen, BRE-Jahresverlauf, Export). Geplant für einen späteren Release.
- **Versicherte** (`/insured`, `/insured/[id]`) — zentraler Knoten für versicherte Personen: Tarif, KVNR, Selbstbehalt, BRE-Staffel, Günstigerprüfungs-Verdikt je Leistungsjahr, Rechnungsliste. Primärer Ort für BRE-Information (vollständig).
- **Verträge** (`/contracts/[id]`) — Verwaltung des Vertrags und seiner versicherten Personen (kompakter BRE-Status mit Link auf `/insured/[id]`).
- **Personen** (`/persons`) — Verwaltung natürlicher Personen (Versicherungsnehmer, Haushaltsmitglieder). Versicherungsspezifische Daten (KVNR, Tarif, BRE) leben ausschließlich in `insured_persons`, nicht hier.

**Begriffliche Trennung (UI-Labels):**

| Begriff | Bedeutung | Primäre Route |
|---|---|---|
| Person | Natürliche Person (Name, Geburtsdatum) | `/persons` |
| Versicherungsnehmer (VN) | Person als Vertragsinhaber | `/contracts/[id]` |
| Versicherte Person | Person mit Tarif, KVNR, BRE auf einem Vertrag | `/insured/[id]` |

Das **maßgebliche Günstigerprüfungs-Verdikt** liegt auf `/insured/[id]` (pro Leistungsjahr,
aggregiert über alle Rechnungen der Person, §5.2). `/invoices/[id]` zeigt nur die Marginalanzeige
(Beitrag dieser Rechnung je Leistungsjahr) sowie den Status-Workflow (§3.2).

### 6.2 Kern-Komponenten

| Komponente | Datei | Zweck |
|---|---|---|
| `OCRScanner` | `lib/components/OCRScanner.svelte` | Kamera-Aufnahme + PaddleOCR-Aufruf |
| `GCPCard` | `lib/components/GCPCard.svelte` | Günstigerprüfungs-Verdikt je Leistungsjahr (auf `/insured/[id]`) |
| `GCPContributionCard` | `lib/components/GCPContributionCard.svelte` | Marginalanzeige auf der Einzelrechnung (Beitrag je Leistungsjahr) |
| `InvoiceStatusFlow` | `lib/components/InvoiceStatusFlow.svelte` | Status-Workflow + Erstattungs-Erfassung je Position |
| `ContractCard` | `lib/components/ContractCard.svelte` | Vertragszusammenfassung |
| `BRETracker` | `lib/components/BRETracker.svelte` | BRE-Staffel-Fortschrittsanzeige; `compact` + optionaler `href` für verlinkte Kompaktkarten (Dashboard, Vertragsdetail) |
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

Der Manifest-Link (`app.html`) trägt `crossorigin="use-credentials"`: hinter der
Reverse-Proxy-Basic-Auth (§7.2-Standard) lädt der Browser das Manifest – und die
darin referenzierten Icons – sonst **ohne** Credentials, der Proxy antwortet mit
401 + Login-HTML, das Manifest wird nie geparst und die App ist nicht
installierbar. Mit dem Attribut wird die gespeicherte Basic Auth mitgesendet.

Service Worker Strategie:
- **Shell-Dateien** (App-Code, GOÄ-Tabelle): Cache First
- **API-Aufrufe** (REST): Network First mit Offline-Queue für Schreiboperationen
- **OCR-Assets** unter `/models/**` (PP-OCRv5-Modelle ~12 MB + ONNX-Runtime-WASM unter `/models/ort/` ~38 MB): Cache After First Load. Beide werden zur Build-/Deploy-Zeit lokal bereitgestellt (`pnpm ocr:models` bzw. `scripts/copy-ort-wasm.mjs` im Frontend-Build), nicht von einem CDN.

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
GET    /api/invoices/:id              → Rechnungsdetail inkl. Positionen + Status-Events
PUT    /api/invoices/:id              → Rechnung aktualisieren (nur Status 'neu'/'geprüft'; ab 'bezahlt' gesperrt)
DELETE /api/invoices/:id              → Rechnung löschen

POST   /api/invoices/:id/status       → Statuswechsel (schreibt invoice_status_events mit Zeitstempel)
POST   /api/invoices/:id/submit       → Einreichung erfassen (→ Status 'eingereicht')
PUT    /api/invoices/:id/refund       → Erstattungseingang je Position erfassen (→ Status 'erstattet')

GET    /api/stats/year/:year          → Jahresauswertung
GET    /api/stats/bre/:insuredPersonId → BRE-Verlauf einer versicherten Person

GET    /api/export/db                 → SQLite-Datenbank-Download (für Backup)
POST   /api/import/db                 → Datenbank-Wiederherstellung
```

### 7.2 Authentifizierung

Da die App im Heimnetz betrieben wird, ist eine einfache Lösung ausreichend:

- **Single-Origin (Standard):** Das Frontend-nginx leitet `/api` an das Backend
  weiter, sodass der Browser nur mit einer Origin spricht. Dadurch deckt die
  Basic Auth des Reverse Proxy die API mit ab und es entsteht **kein CORS**.
  `PUBLIC_API_URL` bleibt leer (gleiche Origin). Empfohlen.
- **Primär:** HTTP Basic Auth über nginx/Traefik Reverse Proxy (keine App-eigene Auth nötig)
- **Optional:** Single Token-basierte Auth im Backend (`X-API-Key` Header) für
  externen Zugriff via Tailscale. Nur nötig, wenn das Backend auf einer eigenen,
  vom Browser direkt aufgerufenen Origin läuft (dann zusätzlich `CORS_ORIGINS`
  setzen — die SPA sendet Basic Auth nicht cross-origin).
- **HTTPS:** Pflicht – Let's Encrypt via Traefik oder selbstsigniertes Zertifikat im LAN

### 7.3 Docker Compose

Maßgeblich ist die [`docker-compose.yml`](../docker-compose.yml) im Repo-Root;
die folgende Skizze zeigt nur die wesentliche Struktur. Beide Services
veröffentlichen **keine** Host-Ports — sie liegen hinter dem Reverse Proxy. Im
Single-Origin-Standard (§7.2) routet der Reverse Proxy nur das Frontend; dessen
nginx leitet `/api` intern an das Backend weiter, daher bleibt `PUBLIC_API_URL`
leer.

```yaml
# docker-compose.yml (Auszug)
services:
  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
      args:
        # Leer = gleiche Origin; nginx proxyt /api an das Backend.
        PUBLIC_API_URL: ${PUBLIC_API_URL:-}
    expose:
      - '3000'
    depends_on:
      backend:
        condition: service_healthy

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    volumes:
      - ./data/db:/app/db        # SQLite-Datei persistent
      - ./data/files:/app/files  # Rechnungs-PDFs optional
    environment:
      DATABASE_PATH: /app/db/pkv.sqlite
      API_KEY: ${PKV_API_KEY:-}   # leer → deaktiviert (Single-Origin)
    expose:
      - '8080'
    restart: unless-stopped
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

- [ ] Monorepo-Setup (pnpm workspaces: `apps/frontend/`, `apps/backend/`)
- [ ] Datenbankschema mit Drizzle ORM implementieren
- [ ] REST-API Endpunkte für Contracts und Invoices
- [ ] SvelteKit-Grundgerüst mit Routing
- [ ] Vertragsverwaltung UI (CRUD)
- [ ] Manuelle Rechnungserfassung (ohne OCR)
- [ ] Günstigerprüfungs-Formel implementieren
- [ ] Docker Compose Setup

### Phase 2: OCR-Integration

- [ ] PP-OCRv5 (`ppu-paddle-ocr`) als Web Worker einbinden
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
| OCR-Bindung Lizenz | ✅ OK | `ppu-paddle-ocr` MIT, ONNX Runtime MIT [^6] |
| SvelteKit Lizenz | ✅ OK | MIT |

***

## Anhang A: Verzeichnisstruktur

```
pkv-manager/
├── docker-compose.yml
├── .env.example
├── apps/frontend/
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
├── apps/backend/
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
| `ppu-paddle-ocr` | ^6.0 | PP-OCRv5 Browser-OCR (Web Worker, WebGPU/WASM) [^6] |
| `onnxruntime-web` | ^1.27 | ONNX-Runtime-Backend für `ppu-paddle-ocr` |
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

