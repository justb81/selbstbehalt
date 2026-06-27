# Implementierungs-Roadmap

Dieser Plan ist aus [`docs/design.md`](./design.md) abgeleitet und als Satz von GitHub-Issues
hinterlegt. Jedes Issue ist eigenständig umsetzbar; Abhängigkeiten sind sowohl im jeweiligen
Issue als auch im Graphen unten dokumentiert. Übergeordnete Übersicht: **Issue #40** (Meta).

Empfohlene Reihenfolge: **Phase 0 → 1 → 2 → 3 → 4**. Innerhalb einer Phase können unabhängige
Issues parallel bearbeitet werden.

## Label-Schema

- **type:** `type:feature`, `type:domain`, `type:infra`, `type:ci-cd`, `type:test`, `type:security`, `type:docs`
- **area:** `area:frontend`, `area:backend`, `area:database`, `area:domain-logic`, `area:ocr`, `area:pwa`, `area:devops`
- **phase:** `phase:0-foundation`, `phase:1-mvp`, `phase:2-ocr`, `phase:3-polish`, `phase:4-extensions`
- **priority:** `priority:high`, `priority:medium`, `priority:low`
- **sonstige:** `privacy` (Privacy-by-Design-relevant), `epic` (Meta/Übersicht)
- **gemeldete Issues:** Über die Issue-Templates eingereichte Issues nutzen die GitHub-Standard-Labels (`bug`, `enhancement`, `documentation`, `question`, …); die obige `type:`/`area:`/`phase:`-Taxonomie ist primär für die geplanten Umsetzungs-Issues gedacht.

## Phase 0 — Fundament & DevEx

| Issue | Titel | Abhängig von |
|---|---|---|
| #2 | Monorepo-Grundgerüst (pnpm Workspaces) | – |
| #3 | TypeScript, ESLint, Prettier, Git-Hooks | #2 |
| #4 | Test-Infrastruktur (Vitest + Playwright + Coverage) | #2, #3 |
| #5 | CI-Pipeline (Lint/Typecheck/Test/Build) | #2, #3, #4 |
| #6 | Sicherheits-/Abhängigkeits-Automatisierung (CodeQL, Audit, Dependabot, SBOM) | #5 |
| #7 | Repo-Meta (.env.example, CONTRIBUTING, Templates, CODEOWNERS) | #2 |

## Phase 1 — MVP: Backend, Domäne & Frontend

| Issue | Titel | Abhängig von |
|---|---|---|
| #8 | Datenbank-Schicht (Drizzle + SQLite + Schema) | #2, #3 |
| #9 | Backend-Grundgerüst (Hono + Middleware + Auth) | #2, #3 |
| #10 | Geteilte Zod-Schemas & Typen | #2, #3 |
| #11 | Contracts-API (CRUD) | #8, #9, #10 |
| #12 | Invoices-API (CRUD + Submit + Refund) | #8, #9, #10 |
| #13 | Stats-API (Jahr + BRE) | #8, #9, #12, #17 |
| #14 | Backup-API (Export/Import) | #8, #9 |
| #15 | GOÄ/GOZ/GOT-Lookup-Tabellen | #2 |
| #16 | GOÄ-Parser + Steigerungsfaktor-Validierung (§5) | #15, #4 |
| #17 | BRE-Helfer (Streak/Projektion) | #4, #10 |
| #18 | Günstigerprüfung-Engine | #17, #4 |
| #19 | SvelteKit-Grundgerüst + API-Client | #2, #3, #10 |
| #20 | Einstellungs-Seite | #19, #14 |
| #21 | Vertragsverwaltung-UI (ContractCard, BRETracker) | #19, #11, #17 |
| #22 | Rechnungs-UI (InvoiceReview, GCPCard, InvoiceBadge) | #19, #12, #16, #18, #20 |
| #23 | Dashboard | #21, #22, #13 |
| #30 | Containerisierung (Docker Compose) | #9, #19 |

## Phase 2 — OCR (client-seitig)

| Issue | Titel | Abhängig von |
|---|---|---|
| #24 | OCR-Web-Worker + PaddleOCR.js (WebGPU/WASM) | #19 |
| #25 | Bildaufnahme & -vorverarbeitung | #19 |
| #26 | Scan-Flow (Scan → Parse → Review → Speichern) | #24, #25, #16, #22 |

## Phase 3 — PWA, Auswertung, Polish, Security & Release

| Issue | Titel | Abhängig von |
|---|---|---|
| #27 | PWA (Manifest, Service Worker, Caching, Offline-Queue) | #19, #24 |
| #28 | Jahresauswertung + CSV/PDF-Export | #13, #23 |
| #29 | Polish (A11y, i18n, Responsive, optional Push) | #19, #27, #12 |
| #31 | Hardening (CSP, Header, Reverse-Proxy/HTTPS, SQLCipher) | #30, #9 |
| #32 | Privacy-/DSGVO-Review (Datenfluss-Audit) | #26, #31, #27 |
| #33 | Release-Pipeline (GHCR-Images, GitHub Release) | #5, #30 |
| #34 | Docs (Self-Hosting-README, OpenAPI) | #11–#14, #30 |

## Phase 4 — Erweiterungen

| Issue | Titel | Abhängig von |
|---|---|---|
| #35 | Mehrbenutzer-/Familien-Support | #8, #21, #13 |
| #36 | Beihilfe-Unterstützung | #11, #18 |
| #37 | Optionaler LLM-Handschrift-Fallback (Opt-in) | #26 |
| #38 | n8n-Einreichungs-E-Mails | #12 |
| #39 | Native Android-App via Tauri *(aus Repo-Beschreibung; mit Maintainer abstimmen)* | #19, #27 |

## Abhängigkeits-Graph (Auszug)

```
#2 ─┬─ #3 ─┬─ #4 ── #5 ── #6
    │      └─ #7
    ├─ #8 ──┐
    ├─ #9 ──┼─ #11/#12/#13/#14
    ├─ #10 ─┘
    ├─ #15 ── #16 ───────────────┐
    ├─ #17 ── #18 ──────────────┐│
    └─ #19 ─┬─ #20 ── #22 ◀──────┘│
            ├─ #21 ◀── #11,#17    │
            ├─ #22 ◀── #12,#16,#18,#20
            └─ #23 ◀── #21,#22,#13

#19 ─┬─ #24 ─┐
     └─ #25 ─┴─ #26 ◀── #16,#22          (Scan-Flow)

#9,#19 ── #30 ── #31 ── #32              (Deploy → Hardening → Review)
#5,#30 ── #33                             (Release)
#19,#24 ── #27 ── #29                      (PWA → Polish)
#13,#23 ── #28                             (Stats-Seite)
```

### Kritischer Pfad zum nutzbaren MVP

`#2 → #3 → {#8,#9,#10} → {#11,#12} → #19 → {#21,#22} → #23`

Paralleler Domänen-Strang: `#15 → #16` und `#17 → #18`, der in #22 (Rechnungs-UI/GCPCard) einfließt.
