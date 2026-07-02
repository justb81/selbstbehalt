# Implementierungs-Roadmap

Dieser Plan ist aus [`docs/design.md`](./design.md) abgeleitet und als Satz von GitHub-Issues
hinterlegt. Jedes Issue ist eigenständig umsetzbar; Abhängigkeiten sind sowohl im jeweiligen
Issue als auch im Graphen unten dokumentiert. Übergeordnete Übersicht: **Issue #40** (Meta).

Empfohlene Reihenfolge: **Phase 0 → 1 → 2 → 3 → 4**. Innerhalb einer Phase können unabhängige
Issues parallel bearbeitet werden.

**Status-Legende:** ✅ erledigt (Issue geschlossen) · 🚧 in Arbeit (offener PR) · ⬜ offen.
Die Spalte spiegelt den GitHub-Issue-Status wider und wird mit jedem umgesetzten Issue aktualisiert.

## Label-Schema

- **type:** `type:feature`, `type:domain`, `type:infra`, `type:ci-cd`, `type:test`, `type:security`, `type:docs`
- **area:** `area:frontend`, `area:backend`, `area:database`, `area:domain-logic`, `area:ocr`, `area:pwa`, `area:devops`
- **phase:** `phase:0-foundation`, `phase:1-mvp`, `phase:2-ocr`, `phase:3-polish`, `phase:4-extensions`
- **priority:** `priority:high`, `priority:medium`, `priority:low`
- **sonstige:** `privacy` (Privacy-by-Design-relevant), `epic` (Meta/Übersicht)
- **gemeldete Issues:** Über die Issue-Templates eingereichte Issues nutzen die GitHub-Standard-Labels (`bug`, `enhancement`, `documentation`, `question`, …); die obige `type:`/`area:`/`phase:`-Taxonomie ist primär für die geplanten Umsetzungs-Issues gedacht.

## Phase 0 — Fundament & DevEx

| Issue | Titel | Abhängig von | Status |
|---|---|---|---|
| #2 | Monorepo-Grundgerüst (pnpm Workspaces) | – | ✅ |
| #3 | TypeScript, ESLint, Prettier, Git-Hooks | #2 | ✅ |
| #4 | Test-Infrastruktur (Vitest + Playwright + Coverage) | #2, #3 | ✅ |
| #5 | CI-Pipeline (Lint/Typecheck/Test/Build) | #2, #3, #4 | ✅ |
| #6 | Sicherheits-/Abhängigkeits-Automatisierung (CodeQL, Audit, Dependabot, SBOM) | #5 | ✅ |
| #7 | Repo-Meta (.env.example, CONTRIBUTING, Templates, CODEOWNERS) | #2 | ✅ |

## Phase 1 — MVP: Backend, Domäne & Frontend

| Issue | Titel | Abhängig von | Status |
|---|---|---|---|
| #8 | Datenbank-Schicht (Drizzle + SQLite + Schema) | #2, #3 | ✅ |
| #9 | Backend-Grundgerüst (Hono + Middleware + Auth) | #2, #3 | ✅ |
| #10 | Geteilte Zod-Schemas & Typen | #2, #3 | ✅ |
| #11 | Contracts-API (CRUD) | #8, #9, #10 | 🚧 |
| #12 | Invoices-API (CRUD + Submit + Refund) | #8, #9, #10 | 🚧 |
| #13 | Stats-API (Jahr + BRE) | #8, #9, #12, #17 | 🚧 |
| #14 | Backup-API (Export/Import) | #8, #9 | 🚧 |
| #15 | GOÄ/GOZ/GOT-Lookup-Tabellen | #2 | ✅ |
| #16 | GOÄ-Parser + Steigerungsfaktor-Validierung (§5) | #15, #4 | ✅ |
| #17 | BRE-Helfer (Streak/Projektion) | #4, #10 | ⬜ |
| #65 | `included_benefits`-Schema (Tarif-Erstattungsregeln) | #8, #10 | ⬜ |
| #66 | Erstattungs-Engine (`eligible_amount` aus Tarifbausteinen) | #65, #16, #4 | ⬜ |
| #18 | Günstigerprüfung-Engine | #17, #4 | ⬜ |
| #19 | SvelteKit-Grundgerüst + API-Client | #2, #3, #10 | ✅ |
| #20 | Einstellungs-Seite | #19, #14 | ⬜ |
| #21 | Vertragsverwaltung-UI (ContractCard, BRETracker) | #19, #11, #17 | ⬜ |
| #22 | Rechnungs-UI (InvoiceReview, GCPCard, InvoiceBadge) | #19, #12, #16, #18, #20 | ⬜ |
| #23 | Dashboard | #21, #22, #13 | ⬜ |
| #30 | Containerisierung (Docker Compose) | #9, #19 | ✅ |

## Günstigerprüfung-Redesign (Epic #146)

Die Günstigerprüfung wird von **pro Rechnung** auf **pro versicherter Person × Leistungsjahr**
umgestellt (Selbstbehalt als Jahresgröße, BRE-Verlust einmal pro Jahr und erst bei tatsächlicher
Erstattung, Leistungsjahr = `treatment_date` der Position; BRE-Verlust als Differenz zweier
abgezinster Ströme inkl. Mehrjahres-Wiederaufstieg). Siehe `docs/design.md` §3.2 + §5. **Strikt
sequentiell, ohne inkonsistenten Zwischenstand.**

| Issue | Titel | Abhängig von | Hinweis | Status |
|---|---|---|---|---|
| #139 | Datenmodell-Umstellung (Positionen als Quelle der Wahrheit, Status-Workflow, Leistungsjahr) | #8, #10, #12, #66, #65 | ⚠️ **ATOMAR**: shared+backend+frontend in einem PR | ⬜ |
| #140 | Engine: Aggregation Person × Leistungsjahr + korrigierte Abzinsung (Sofort-Term) | #139 | Signaturänderung ⇒ Aufrufstellen mitziehen | ⬜ |
| #141 | Engine: Mehrjahres-Leiter-NPV mit Wahrscheinlichkeits-Dämpfung (`p`) | #140 | rein additiv | ⬜ |
| #142 | Frontend: Status-Workflow-UI + Erstattungs-Erfassung je Position | #139 | parallel zu #140/#141 möglich | ⬜ |
| #134 | Frontend: Person-×-Jahr-Verdikt + Marginalanzeige (zusammengeführt mit IA „Person als Knoten") | #140, #141, #142 | löst Pro-Rechnungs-Verdikt (#18/#22) ab; ehem. #143 | ⬜ |
| #144 | Folge: BRE-Auszahlungsmonat pro Vertrag konfigurierbar | #140 | nicht blockierend (Default Juli) | ⬜ |
| #145 | Folge: `p` datengetrieben aus der Historie schätzen | #141 | nicht blockierend (Default 0,7) | ⬜ |

Empfohlene Reihenfolge: **#139 → #140 → #141 → #142 → #134**, danach #144/#145 nach Bedarf. (Schritt 5/5, ehemals #143, wurde in #134 „versicherte Person als Knoten" eingegliedert.)

## Phase 2 — OCR (client-seitig)

| Issue | Titel | Abhängig von | Status |
|---|---|---|---|
| #24 | OCR-Web-Worker + PP-OCRv5 (`ppu-paddle-ocr`, WebGPU/WASM) | #19 | ✅ |
| #25 | Bildaufnahme & -vorverarbeitung | #19 | ✅ |
| #26 | Scan-Flow (Scan → Parse → Review → Speichern) | #24, #25, #16, #22 | 🚧 |

## Phase 3 — PWA, Auswertung, Polish, Security & Release

| Issue | Titel | Abhängig von | Status |
|---|---|---|---|
| #27 | PWA (Manifest, Service Worker, Caching, Offline-Queue) | #19, #24 | ⬜ |
| #28 | Jahresauswertung (`/stats`, Diagramme) | #13, #23 | ✅ |
| #184 | CSV/PDF-Export der Jahresauswertung (aus #28 ausgegliedert) | #13, #28 | ⬜ |
| #29 | Polish (A11y, i18n, Responsive, optional Push) | #19, #27, #12 | ⬜ |
| #31 | Hardening (CSP, Header, Reverse-Proxy/HTTPS, SQLCipher) | #30, #9 | ✅ |
| #32 | Privacy-/DSGVO-Review (Datenfluss-Audit) | #26, #31, #27 | ⬜ |
| #33 | Release-Pipeline (GHCR-Images, GitHub Release) | #5, #30 | 🚧 |
| #34 | Docs (Self-Hosting-README, OpenAPI) | #11–#14, #30 | ⬜ |
| #133 | Navigationsstruktur optimieren (Bottom-Nav, Bündelung, Breadcrumbs, shadcn-Migration) | #19, #26, #29 | ⬜ |
| #134 | Versicherte Person als Knoten: IA-Neuordnung + Günstigerprüfung-Verdikt je Leistungsjahr (Redesign 5/5, ehem. #143) | #133, #23, #28, #140, #141, #142 | ⬜ |

## Phase 4 — Erweiterungen

| Issue | Titel | Abhängig von | Status |
|---|---|---|---|
| #35 | Mehrbenutzer-/Familien-Support | #8, #21, #13 | ⬜ |
| #36 | Beihilfe-Unterstützung | #11, #18 | ⬜ |
| #37 | Optionaler LLM-Handschrift-Fallback (Opt-in) | #26 | ⬜ |
| #38 | n8n-Einreichungs-E-Mails | #12 | ⬜ |
| #39 | Native Android-App via Tauri *(aus Repo-Beschreibung; mit Maintainer abstimmen)* | #19, #27 | ⬜ |
| #82 | Datenmodell: Rezept-Belege (Hilfsmittel/Arznei-/Heilmittel) erfassbar | #8, #10, #65, #66 | ⬜ |
| #83 | Invoices-API: Rezept-Belege persistieren & validieren | #82, #12 | ⬜ |
| #84 | Beleg-Erfassungs-UI: Rezepte (Hilfsmittel/Arznei-/Heilmittel) | #82, #83, #22 | ⬜ |
| #85 | Beleg-OCR/-Parser für Apotheken-/Hilfsmittel-Belege (PZN/HMV) | #26, #82 | ⬜ |

## Abhängigkeits-Graph (Auszug)

```
#2 ─┬─ #3 ─┬─ #4 ── #5 ── #6
    │      └─ #7
    ├─ #8 ──┐
    ├─ #9 ──┼─ #11/#12/#13/#14
    ├─ #10 ─┘
    ├─ #15 ── #16 ──┬────────────┐
    │               └─ #66 ◀── #65,#16
    ├─ #17 ── #18 ──────────────┐│
    ├─ #65 ── #66 ──────────────┤│   (Tarif-Schema → Erstattungs-Engine → R)
    └─ #19 ─┬─ #20 ── #22 ◀──────┘│
            ├─ #21 ◀── #11,#17    │
            ├─ #22 ◀── #12,#16,#18,#66,#20
            └─ #23 ◀── #21,#22,#13

#65,#66 ── #82 ──┬─ #83 ── #84 ◀── #22   (Rezept-Belege, Phase 4: Schema → API → UI)
                 └─ #85 ◀── #26          (Beleg-OCR, Phase 4)

#139 ─┬─ #140 ── #141 ──┐                 (Günstigerprüfung-Redesign, Epic #146)
      │                 ├─ #134           (Verdikt + Marginalanzeige; inkl. IA „Person als Knoten")
      └─ #142 ──────────┘
       #140 ── #144 · #141 ── #145         (Folge-Issues, nicht blockierend)

#19 ─┬─ #24 ─┐
     └─ #25 ─┴─ #26 ◀── #16,#22          (Scan-Flow)

#9,#19 ── #30 ── #31 ── #32              (Deploy → Hardening → Review)
#5,#30 ── #33                             (Release)
#19,#24 ── #27 ── #29                      (PWA → Polish)
#13,#23 ── #28 ── #184                    (Stats-Seite → Export)
#19,#26 ── #133 ── #134 ◀── #23,#28       (Nav-Mechanik → IA-Neuordnung)
```

### Kritischer Pfad zum nutzbaren MVP

`#2 → #3 → {#8,#9,#10} → {#11,#12} → #19 → {#21,#22} → #23`

Paralleler Domänen-Strang: `#15 → #16`, `#17 → #18` und `#65 → #66`, die in #22 (Rechnungs-UI/GCPCard) einfließen.

> **Hinweis:** Die Pro-Rechnungs-Günstigerprüfung aus #18/#22 wird durch das **Günstigerprüfung-Redesign** (Epic #146, #139–#143) abgelöst — Entscheidung pro versicherter Person × Leistungsjahr. Siehe den eigenen Abschnitt oben.

### Erweiterung: Rezept-Belege (Hilfsmittel, Arznei- & Heilmittel)

Über GOÄ-Arztrechnungen hinaus sollen per Rezept eingereichte Hilfsmittel, Arznei- und Heilmittel
erfassbar sein. Diese folgen nicht der GOÄ (kein Steigerungsfaktor), sondern *Menge × Einzelpreis*
mit optionaler PZN/Hilfsmittelnummer. Die Erstattungs-Engine (#66) ist bereits generisch über
`BenefitCategory`; die Arbeit liegt im Datenmodell (#82), der API (#83), der Erfassungs-UI (#84) und
optional der Beleg-OCR (#85). Der gesamte Strang ist als **Phase 4 (Erweiterung)** eingeordnet —
bewusst nach dem GOÄ-MVP, da er über die im Design-Dokument dokumentierte MVP-Scope hinausgeht.
