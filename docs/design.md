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
Person (1) ──── (n) Vertrag
Vertrag  (1) ──── (n) Rechnung
Rechnung (1) ──── (n) Rechnungsposition (GOÄ-Ziffer)
Rechnung (1) ──── (1) Einreichung (optional)
Vertrag  (1) ──── (n) BRE-Periode (Beitragsrückerstattungs-Zeitraum)
```

### 3.2 Tabellen-Schema (SQLite / Drizzle ORM)

#### `persons`
```sql
id          TEXT PRIMARY KEY  -- UUID
name        TEXT NOT NULL
birth_date  DATE
role        TEXT              -- 'primary' | 'family_member'
created_at  DATETIME
```

#### `contracts`
```sql
id                    TEXT PRIMARY KEY
person_id             TEXT REFERENCES persons(id)
insurer_name          TEXT NOT NULL          -- z.B. "DKV", "Allianz"
contract_number       TEXT
tariff_name           TEXT                   -- z.B. "KomfortSelect"
type                  TEXT NOT NULL          -- 'vollversicherung' | 'zusatztarif' | 'beihilfe'
start_date            DATE NOT NULL
end_date              DATE                   -- NULL = laufend
monthly_premium       REAL NOT NULL          -- Monatsbeitrag in EUR
self_retention        REAL DEFAULT 0         -- Selbstbehalt p.a. in EUR
bre_structure         TEXT                   -- JSON: Staffelung der Beitragsrückerstattung
included_benefits     TEXT                   -- JSON: Array von enthaltenen Leistungen
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

#### `invoices`
```sql
id                TEXT PRIMARY KEY
contract_id       TEXT REFERENCES contracts(id)
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
id              TEXT PRIMARY KEY
contract_id     TEXT REFERENCES contracts(id)
year            INTEGER NOT NULL
streak_months   INTEGER DEFAULT 0    -- Leistungsfreie Monate
bre_amount      REAL DEFAULT 0       -- Bereits erzielte BRE in diesem Jahr
projected_bre   REAL                 -- Erwartete BRE bei Leistungsfreiheit
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

Arztrechnungen nach §12 GOÄ folgen einem gesetzlich definierten Schema. Der Parser nutzt reguläre Ausdrücke für die Feldextraktion:

```typescript
// goae-parser.ts
import goaeData from './data/goae-2024.json';  // Statische GOÄ-Lookup-Tabelle

interface ParsedInvoice {
  invoiceDate: string;
  invoiceNumber: string;
  providerName: string;
  positions: ParsedPosition[];
  totalAmount: number;
}

interface ParsedPosition {
  number: string;
  multiplier: number;
  chargedAmount: number;
  baseAmount: number;
  isValid: boolean;
  flagReason?: string;
}

const GOAE_LINE_REGEX = /(\d{3,4}[A-Z]?)\s+([\d,]+)\s+(\d[,\d]*)\s+([\d,.]+)/g;

// Regelsteigerungsgrenzen nach §5 GOÄ
const MULTIPLIER_LIMITS: Record<string, number> = {
  default: 2.3,     // Persönliche ärztliche Leistungen
  technical: 1.8,   // Technische Leistungen
  lab: 1.15,        // Labor (GOÄ Teil M)
  inpatient: 1.8,   // Stationäre Behandlung
};

function parseInvoiceText(ocrText: string): ParsedInvoice {
  // Datum-Extraktion
  const dateMatch = ocrText.match(/(\d{2}\.\d{2}\.\d{4})/);
  
  // Positionen parsen
  const positions: ParsedPosition[] = [];
  let match;
  while ((match = GOAE_LINE_REGEX.exec(ocrText)) !== null) {
    const goaeNumber = match[^1];
    const multiplier = parseFloat(match[^2].replace(',', '.'));
    const chargedAmount = parseFloat(match[^4].replace('.', '').replace(',', '.'));
    
    const goaeEntry = goaeData[goaeNumber];
    const baseAmount = goaeEntry?.baseAmount ?? 0;
    const category = goaeEntry?.category ?? 'default';
    const limit = MULTIPLIER_LIMITS[category] ?? MULTIPLIER_LIMITS.default;
    
    positions.push({
      number: goaeNumber,
      multiplier,
      chargedAmount,
      baseAmount,
      isValid: multiplier <= limit,
      flagReason: multiplier > limit
        ? `Steigerungsfaktor ${multiplier} überschreitet Regelgrenze ${limit} (§5 GOÄ)`
        : undefined,
    });
  }
  
  return {
    invoiceDate: dateMatch?. ?? '',
    invoiceNumber: extractInvoiceNumber(ocrText),
    providerName: extractProviderName(ocrText),
    positions,
    totalAmount: positions.reduce((s, p) => s + p.chargedAmount, 0),
  };
}
```

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

Die Tabelle umfasst alle ~4.500 Ziffern der GOÄ (aktuell GOÄ 1996 mit Anpassungskursfaktor), GOZ (Zahnärzte) und GOT (Tierärzte, für Haustierversicherung). Sie wird versioniert im Git-Repository gepflegt und kann per Community-Beitrag aktualisiert werden.

***

## 5. Günstigerprüfung

### 5.1 Entscheidungslogik

Die Günstigerprüfung beantwortet: **Lohnt es sich, eine Rechnung einzureichen, oder soll ich sie selbst zahlen, um meine Beitragsrückerstattungs-Staffel nicht zu unterbrechen?**

Die relevanten Variablen:

| Variable | Quelle |
|---|---|
| $$R$$ | Erstattungsbetrag der Rechnung (eligible_amount) |
| $$S$$ | Verbleibender Selbstbehalt im Kalenderjahr |
| $$B_n$$ | BRE bei Leistungsfreiheit noch n Monate (aus bre_structure) |
| $$P$$ | Monatlicher Beitrag |
| $$i$$ | Diskontierungsrate (Standard: 3% p.a.) |
| $$T$$ | Steuersatz des Nutzers (für Steuerersparnis bei Selbstzahlung) |

**Entscheidungsregel:**

Einreichen lohnt sich, wenn:

$$ R - S > \text{NPV}(\Delta \text{BRE}) - \text{Steuervorteil}(R) $$

wobei $$\text{NPV}(\Delta \text{BRE})$$ der Kapitalwert des entgehenden BRE-Vorteils durch die Unterbrechung der Leistungsfreiheits-Staffel ist [^9].

### 5.2 Implementierung

```typescript
// guenstiger-pruefung.ts

interface GCP_Input {
  rechnungsBetrag: number;
  erstattungsBetrag: number;       // Was die PKV erstatten würde
  verbleibenderSelbstbehalt: number;  // Noch offener Selbstbehalt dieses Jahr
  breStructure: BREStructure;
  monthlyPremium: number;
  taxRate: number;                 // 0.0 – 1.0, z.B. 0.42 für 42%
  discountRate?: number;           // Default: 0.03
}

interface GCP_Result {
  recommendation: 'einreichen' | 'selbst_zahlen';
  netBenefitOfSubmitting: number;  // Positiv = Einreichen lohnt
  breakdown: {
    refundAfterDeductible: number;
    lostBREValue_NPV: number;
    taxSavingFromSelfPay: number;
  };
  explanation: string;
}

function calculateGCP(input: GCP_Input): GCP_Result {
  const {
    erstattungsBetrag,
    verbleibenderSelbstbehalt,
    breStructure,
    monthlyPremium,
    taxRate,
    discountRate = 0.03,
  } = input;

  // Nettoerstattung nach Selbstbehalt
  const refundAfterDeductible = Math.max(0, erstattungsBetrag - verbleibenderSelbstbehalt);

  // BRE-Verlust durch Unterbrechung der Staffel
  const currentStreak = getCurrentStreakMonths(breStructure);
  const potentialBRE = getProjectedBRE(breStructure, monthlyPremium);
  const lostBRE = potentialBRE; // Worst case: Staffel auf 0 zurückgesetzt

  // Abzinsung des BRE-Wertes auf heute (er wird erst am Jahresende ausgezahlt)
  const monthsToYearEnd = 12 - new Date().getMonth();
  const lostBREValue_NPV = lostBRE / Math.pow(1 + discountRate / 12, monthsToYearEnd);

  // Steuerersparnis bei Selbstzahlung (§10 Abs. 1 Nr. 3a EStG)
  // Selbst gezahlte PKV-Beiträge und Krankheitskosten sind begrenzt absetzbar
  const taxSavingFromSelfPay = input.rechnungsBetrag * taxRate * 0.5; // Vereinfacht

  const netBenefitOfSubmitting = refundAfterDeductible - lostBREValue_NPV + taxSavingFromSelfPay;

  return {
    recommendation: netBenefitOfSubmitting > 0 ? 'einreichen' : 'selbst_zahlen',
    netBenefitOfSubmitting,
    breakdown: {
      refundAfterDeductible,
      lostBREValue_NPV,
      taxSavingFromSelfPay,
    },
    explanation: buildExplanation(netBenefitOfSubmitting, refundAfterDeductible, lostBREValue_NPV),
  };
}
```

### 5.3 Benutzeroberfläche der Günstigerprüfung

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
GET    /api/contracts                 → Alle Verträge
POST   /api/contracts                 → Neuen Vertrag anlegen
GET    /api/contracts/:id             → Vertragsdetail
PUT    /api/contracts/:id             → Vertrag aktualisieren
DELETE /api/contracts/:id             → Vertrag löschen

GET    /api/invoices                  → Alle Rechnungen (mit Filter-Query-Params)
POST   /api/invoices                  → Neue Rechnung speichern
GET    /api/invoices/:id              → Rechnungsdetail inkl. Positionen
PUT    /api/invoices/:id              → Rechnung aktualisieren
DELETE /api/invoices/:id              → Rechnung löschen

POST   /api/invoices/:id/submit       → Einreichung erfassen
PUT    /api/invoices/:id/refund       → Erstattungseingang erfassen

GET    /api/stats/year/:year          → Jahresauswertung
GET    /api/stats/bre/:contractId     → BRE-Verlauf eines Vertrags

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

