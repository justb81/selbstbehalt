# UI-Handover – PKV-Manager (selbstbehalt)

> **Zweck dieses Dokuments:** Übergabe des UI-Entwurfs an die Frontend-Entwicklung.
> Beschreibt die in der interaktiven Vorlage umgesetzten Screens, das visuelle System,
> die Komponenten und den Abbildungsgrad gegenüber [`docs/design.md`](./design.md).
> Bezugs-Issues: **#20** (Einstellungen), **#21** (Vertragsverwaltung), **#22** (Rechnungs-UI),
> **#23** (Dashboard) sowie die Stammdaten-/CRUD-Flows (Personen, Vertrag-Wizard).

Die Vorlage ist ein **High-Fidelity-Klickprototyp** (eigenständige HTML/Design-Component).
Sie ist **keine** SvelteKit-Implementierung, sondern die verbindliche Referenz für Layout,
Zustände, Interaktionen, Copy und das visuelle System. Alle Daten sind In-Memory-Mocks;
Schreibvorgänge (Anlegen/Bearbeiten/Löschen, Günstigerprüfungs-Entscheidung) wirken nur in
der laufenden Sitzung.

---

## 1. Visuelles System

### 1.1 Farben (Tokens)

Die Vorlage definiert die Tokens als CSS-Custom-Properties am Wurzel-Container.

| Token | Wert | Verwendung |
|---|---|---|
| `--ink` | `#1c2521` | Primärtext |
| `--muted` | `#5e655d` | Sekundärtext |
| `--faint` | `#8a9088` | Labels, Captions |
| `--paper` | `#f1efe8` | App-Hintergrund |
| `--surface` | `#ffffff` | Karten, Panels |
| `--surface-2` | `#faf8f1` | Eingabefelder, eingebettete Boxen |
| `--line` | `#e5e1d6` | Trennlinien, Kartenrand |
| `--line-2` | `#d8d3c6` | Input-Rand, kräftigere Linie |
| `--primary` | `#0e4d45` | Primäraktion, Vollversicherung, aktive Nav |
| `--primary-700` | `#0a3c36` | Verlauf (dunkel) |
| `--primary-soft` | `#e2ece9` | Primär-Badge/Hintergrund |
| `--accent` | `#2f8f5b` | Positiv/„Selbst zahlen", Fortschritt |
| `--accent-ink` | `#1f6b40` | Akzenttext |
| `--accent-soft` | `#e3f0e7` | Akzent-Badge |
| `--warn` / `--warn-soft` | `#a9760f` / `#f5ecd6` | §5-Warnung, „eingereicht", Beihilfe-Badge |
| `--danger` / `--danger-soft` | `#b03a2b` / `#f5e1dc` | Löschen, „abgelehnt" |
| `--gold` | `#b08a3e` | Selbstbehalt-Fortschritt, BRE-Kennzahl |

### 1.2 Typografie

- **IBM Plex Sans** – UI-Standard (400/500/600/700)
- **IBM Plex Serif** – Überschriften, Marken-/Versicherer-Namen, große Empfehlungen (500/600)
- **IBM Plex Mono** – alle Geldbeträge, Nummern, IDs, Datumswerte, Faktoren

Skala (Richtwerte): H1 24–27 px · Sektionsüberschrift 14 px · Body 13,5–14 px ·
Caption/Label 11–12 px (Labels `text-transform:uppercase; letter-spacing:.04em`).

### 1.3 Form & Abstand

- Karten-Radius 12–14 px; Buttons/Inputs 9–10 px; Badges 6–7 px.
- Kartenabstände 13–16 px; Seitenpolster Desktop `30px 36px`, Mobile `18px 16px`.
- Geldbeträge immer rechtsbündig, Mono, mit `\u00a0€` (geschütztes Leerzeichen).
- Beträge deutsch formatiert (`1.090,00 €`).

---

## 2. Informationsarchitektur & Navigation

Desktop: feste Seitenleiste (236 px) mit 4 Einträgen + Profilfuß.
Mobile (< 560 px): Top-Header + untere Tab-Bar (Start · Verträge · Belege · Mehr).
Umschaltung per `ResizeObserver` am Container-Breakpoint **560 px** (kein Media-Query,
damit beide Geräteframes unabhängig im Canvas funktionieren).

| Bereich | Route (`design.md` §6.1) | Screen(s) in der Vorlage |
|---|---|---|
| Dashboard | `/` | Übersicht |
| Verträge | `/contracts`, `/contracts/[id]`, `/contracts/new` | Liste · Detail · Wizard (neu/bearbeiten) |
| Rechnungen | `/invoices`, `/invoices/[id]`, `/invoices/scan` | Liste · Detail + GCP · Scan-Review |
| Einstellungen | `/settings` | Einstellungen |
| Stammdaten | (Teil von `/settings` / Personen-CRUD) | Personen-Verwaltung |

---

## 3. Screens

### 3.1 Dashboard (`#23`)
- Begrüßung mit Datum + aktueller Person.
- 4 Kennzahlkarten: **Offene Rechnungen**, **Erstattungen 2026**, **In Einreichung**,
  **BRE erwartet 2026** (Summe `projected_bre` aller versicherten Personen).
- **Günstigerprüfungs-Hero** (Empfehlung der wichtigsten offenen Rechnung) → öffnet das Rechnungsdetail.
- Zwei Spalten: **Offene Rechnungen** (mit Person · Art · Datum + Empfehlungs-Badge) und
  **BRE-Status je versicherte Person** (Fortschrittsbalken zur ersten/letzten Staffelstufe).

### 3.2 Verträge – Liste (`#21`)
- Kopf: Zusammenfassung „N Verträge · M versicherte Personen", Buttons **Person** (→ Stammdaten)
  und **Vertrag** (→ Wizard).
- Karten je **Hauptvertrag**: Versicherer (Serif), Versicherungsschein-Nr. (Mono), Vertragsart-Badge,
  Versicherungsnehmer/in, darunter die **versicherten Personen** (Name + VN-Badge, Tarif, Beitrag, BRE-Kurzwert).

### 3.3 Verträge – Detail (`#21`)
- Kopfkarte: Vertragsart, Versicherer, Schein-Nr., VN, Vertragsbeginn, Anzahl versicherter Personen,
  **Gesamtbeitrag/Monat** und **Bearbeiten**-Button (→ Wizard im Edit-Modus).
- Pro **versicherter Person** eine Sektion mit:
  - Kopf: Name + Rolle (Versicherungsnehmer/in vs. mitversichert), Tarif, KVNR, Beitrag.
  - **BRETracker**: Fortschrittsbalken + Staffelstufen (erreicht/offen, je `bre_months × Beitrag`).
  - **Selbstbehalt**-Tracker (verbraucht/frei), nur wenn `self_retention > 0`.
  - **Tarifleistungen** (strukturierte `included_benefits`, siehe §4).
  - **Rechnungen dieser Person**.

### 3.4 Vertrag-Wizard – neu & bearbeiten (`#21`, Route `/contracts/new`)
3-stufiger Assistent mit Stepper, funktional (speichert in den State):
1. **Vertrag**: Versicherer, Versicherungsschein-Nr., Vertragsart (Segmented:
   Vollversicherung / Zusatztarif / Beihilfe), Versicherungsnehmer/in (Auswahl), Vertragsbeginn.
2. **Versicherte Personen**: dynamische Liste (hinzufügen/entfernen); je Person Auswahl
   (mit **Schnellanlage** einer neuen Person), KVNR, Tarif, Beitrag/Monat, Selbstbehalt/Jahr.
3. **BRE & Leistungen**: je Person BRE-Schalter → Staffel (2-/3-stufig), leistungsfreie Monate,
   erwartete BRE; Leistungs-Editor (Kategorie, Erstattung %, Wartezeit, Jahreslimit, Beihilfe %).
- **Bearbeiten-Modus**: Felder vorbefüllt, zusätzlich **Vertrag löschen** (entfernt Vertrag,
  versicherte Personen und zugehörige Rechnungen).
- Validierung mit Hinweis-Toast und Rücksprung zum betroffenen Schritt.

### 3.5 Rechnungen – Liste (`#22`)
- Suche (Anbieter **oder** Person), Filter-Chips (Offen · Alle · Eingereicht · Erstattet · Selbst gezahlt).
- Zeilen: Anbieter + Status-Badge (**InvoiceBadge**), Person · Art · Datum · Nr.,
  Betrag und – bei offenen – die GCP-Empfehlung.

### 3.6 Rechnung – Detail + Günstigerprüfung (`#22`)
- Kopf: Status-Badge, Anbieter, Datum/Nr./Kontext (Person · Versicherer · Tarif), Rechnungsbetrag.
- **Positionen** (GOÄ/GOZ) mit §5-Prüfung: markierte Zeilen (Faktor > Regelhöchstsatz) hervorgehoben,
  Sammelhinweis bei Auffälligkeiten, „Erstattungsfähig (Erstattungs-Engine)".
- **GCPCard** (siehe §5).
- Aktionen **Einreichen** / **Selbst zahlen** ändern Status + Entscheidung (Toast).

### 3.7 Scan-Review (`#22`/§4 OCR)
- Datenschutz-Hinweis „client-seitig erkannt, nicht hochgeladen".
- Editierbare erkannte Felder (Person, Anbieter, Datum, Nr.), erkannte Positionen mit Markierung,
  Summe, **Rechnung speichern**.

### 3.8 Einstellungen (`#20`)
- **Stammdaten** → Personen verwalten.
- **Server**: API-URL, API-Key (X-API-Key).
- **Günstigerprüfung**: Diskontierungsrate (wirksam), persönlicher Steuersatz, **§33-Hinweis** (siehe §5).
- **Datenschutz**: Toggle „Rechnungsbilder lokal speichern" (Default aus).
- **Datensicherung**: Export/Import der SQLite-DB (Art. 20 DSGVO).

### 3.9 Personen-Verwaltung (Stammdaten-CRUD)
- Neue Person (Name, Geburtsdatum).
- Liste mit Initialen-Avatar, Geburtsdatum, **Verknüpfungs-Status** (N× VN · M× versichert).
- **Inline-Bearbeiten**; **Löschen** mit **Referenz-Guard** (verknüpfte Personen nicht löschbar,
  Aktion ist ausgegraut).

---

## 4. Datenmodell im UI

Die UI folgt `design.md` §3: ein **Hauptvertrag** (`contracts`) trägt Versicherer, Schein-Nr.,
Vertragsart und Versicherungsnehmer/in. Tarifspezifische Größen (Tarif, Beitrag, Selbstbehalt,
BRE, Leistungen) liegen je **versicherter Person** (`insured_persons`). Rechnungen und BRE hängen
an der versicherten Person, nicht am Vertrag.

**Strukturierte `included_benefits`** werden je Leistungsbereich dargestellt:
Erstattungssatz bzw. Schwellen-Staffel (`tiers`), Summengrenzen (`limits`, z. B. „max 1.000 €/Jahr"),
Wartezeit, Beihilfe-Satz (Tarif trägt Restquote) sowie die Aufbaujahres-/Zahnstaffel (`annual_staffel`).

---

## 5. Günstigerprüfung – UI-Vertrag

Die **GCPCard** zeigt die Größen aus `design.md` §5.3 (`GCP_Result.breakdown`):
Rechnungsbetrag, Erstattung PKV (est.), verbleibender Selbstbehalt, **Nettoerstattung**
(`max(0, R − S)`), BRE-Staffel, drohender BRE-Verlust, **NPV BRE-Verlust** (abgezinst mit der
Diskontrate aus den Einstellungen) und **Steuervorteil (§33 EStG)**.

> **Wichtig:** Der Steuervorteil wird **nicht geschätzt**. Gemäß §5.1/§5.2 fließt er als
> `taxSavingFromSelfPay` mit **Default 0 €** ein („kein erfundener Vorteil"), bis der §33-Helfer
> vorliegt. Die Karte weist 0 € mit erklärendem Hinweis aus; die Einstellungen enthalten denselben Hinweis.
> Kopf, Empfehlung („Einreichen"/„Selbst zahlen") und Netto-Vorteil ergeben sich aus
> `R − S − NPV(ΔBRE) − Steuervorteil`.

---

## 6. Zustände & Interaktionen

- Navigation per State-Routing; Rücksprung kontextsensitiv (Detail → jeweilige Liste,
  Personen/Wizard → Einstellungen bzw. Verträge).
- Toasts (~2,6 s) für Schreibaktionen.
- Fortschrittsbalken: BRE (Akzent→Primär-Verlauf), Selbstbehalt (Gold).
- Toggles für BRE-Schalter und „Bilder speichern".
- Hover-/Fokus-Reset auf Buttons/Inputs/Selects.

---

## 7. Umsetzungs-Mapping (`design.md` §6.2)

| Komponente | In der Vorlage abgebildet als |
|---|---|
| `ContractCard` | Vertragskarte (Liste) inkl. versicherte Personen |
| `BRETracker` | BRE-Fortschritt + Staffelstufen (Detail, Dashboard, Wizard-Schritt 3) |
| `InvoiceBadge` | Status-Badges (neu/geprüft/eingereicht/erstattet/abgelehnt/selbst_gezahlt) |
| `GCPCard` | Günstigerprüfungs-Karte im Rechnungsdetail |
| `InvoiceReview` | Scan-Review-Screen |
| `OCRScanner` | Einstieg „Rechnung erfassen" → Review (OCR-Lauf gemockt) |

---

## 8. Offene Punkte / bewusst nicht umgesetzt

- **OCR live** (PaddleOCR/WebGPU) – Scan-Flow ist gemockt (`design.md` §4, Issues #24–#26).
- **Echte API/Persistenz** – alle Daten In-Memory; keine REST-Aufrufe (Issues #11–#14).
- **Leistungs-Editor im Wizard** deckt Satz/Wartezeit/Jahreslimit/Beihilfe ab; die vollständige
  **`tiers`/`annual_staffel`**-Pflege (mehrstufige Schwellen, Zahnstaffel) wird angezeigt,
  aber im Schnell-Editor noch nicht bearbeitet.
- **§33-EStG-Helfer** offen → Steuervorteil bleibt 0 € (Folge-Issue).
- **Stats-Seite** (`/stats`) noch nicht entworfen (Issue #28).

---

## 9. Vorlage ansehen

Die interaktive Vorlage liegt als eigenständige Design-Component außerhalb dieses Repos
(`Selbstbehalt.dc.html` mit eingebettetem `SelbstbehaltApp.dc.html`, Desktop- und Mobile-Frame).
Im Browser öffnen; beide Frames sind unabhängig bedienbar. Maße: Desktop ~1180×760,
Mobile-Frame 400×820 (Breakpoint 560 px).
