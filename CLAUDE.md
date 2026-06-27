# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is **greenfield**: there is no application code yet. The repo currently contains:

- `docs/design.md` — the complete technical and functional specification (German). This is the single source of truth.
- `docs/roadmap.md` — the phased implementation plan, mirroring the GitHub issues (phases, dependencies, label scheme).
- `data/input/{goae,goz,got}/*.xml` — the official gesetze-im-internet.de legal-text exports of the GOÄ/GOZ/GOT fee schedules; build inputs from which the parser's JSON lookup tables are generated (not hand-maintained).
- `README.md`, `LICENSE` (Apache 2.0), and `assets/` (logo + hero image).

When implementing, follow `docs/design.md` as the authoritative spec. The directory layout, data model, API surface, and domain formulas below are all derived from it. Build commands (lint/test/run) do not exist yet — establish them as part of the initial scaffolding.

## What this is

**selbstbehalt** (working title "PKV Manager") is a self-hostable, privacy-first Progressive Web App for managing German private health insurance (PKV). Three core jobs:

1. Manage multiple PKV contracts (Vollversicherung, Zusatztarife, Beihilfe).
2. Capture, parse, and validate doctor invoices (GOÄ/GOZ/GOT fee schedules).
3. Run the **Günstigerprüfung** — decide whether to submit an invoice to the insurer or self-pay to preserve the Beitragsrückerstattung (BRE, premium refund) streak.

The domain is German and insurance-specific. Keep entity/field names in German where the design doc uses them (e.g. `selbstbehalt`, `bre_structure`, `eligible_amount`); UI text is German (`de-DE`).

## Architecture (planned)

Monorepo via **pnpm workspaces** — `frontend/` and `backend/`.

- **Frontend**: SvelteKit (Svelte 5, TypeScript) PWA. Installable, offline-first.
- **Backend**: Hono (TypeScript) REST API on port 8080, SQLite via Drizzle ORM. Minimal — it is *only* a database + REST layer. No AI/LLM workloads server-side ever.
- **OCR**: runs entirely client-side (PaddleOCR.js / PP-OCRv5) in a **Web Worker** with WebGPU + WASM fallback. Invoice images never leave the device.
- **Deployment**: Docker Compose (Proxmox LXC / NAS friendly), intended for home network + optional VPN.

### Non-negotiable design constraints (Privacy by Design)

These come from §1.3 and §8 of the design doc and override convenience:

- **Invoice images never leave the client.** OCR is browser-side; only structured JSON metadata (no images) is sent to the backend. Images are discarded after OCR unless the user explicitly opts to save.
- **No server-side AI/LLM.** All inference is client-side. The backend stays ~128 MB RAM, no GPU.
- **No third-party dependencies at runtime** — no analytics, no external CDN loading.
- Health data falls under Art. 9 DSGVO; treat invoice content and diagnoses as maximally sensitive.

## Data model

Entity relationships (see `docs/design.md` §3 for full SQLite/Drizzle schemas):

```
Person (1) ── (n) Vertrag (contract)
Vertrag (1) ── (n) Rechnung (invoice)
Rechnung (1) ── (n) Rechnungsposition (invoice line / GOÄ code)
Rechnung (1) ── (1) Einreichung (submission, optional)
Vertrag (1) ── (n) BRE-Periode (premium-refund period)
```

Tables: `persons`, `contracts`, `invoices`, `invoice_positions`, `submissions`, `bre_periods`. IDs are UUIDs (TEXT PK). Money is stored as `REAL` in EUR. `bre_structure` and `included_benefits` are JSON stored as TEXT.

## Two domain-critical algorithms

These hold the actual business value — get them right and keep them well-tested.

### 1. GOÄ invoice parser (`frontend/.../utils/goae-parser.ts`)

German doctor invoices follow the legally-defined GOÄ schema (§12 GOÄ). The parser regex-extracts line items, looks each GOÄ code up in a static JSON table (`data/goae-*.json`, ~4500 codes; also GOZ/GOT), and **validates the Steigerungsfaktor (multiplier) against the legal limits in §5 GOÄ**:

- default (personal services): 2.3
- technical: 1.8
- lab (Teil M): 1.15
- inpatient: 1.8

A line exceeding its limit is flagged (`is_valid = false`, with `flag_reason`). The GOÄ lookup tables are version-controlled static JSON — no LLM needed; GOÄ is public.

### 2. Günstigerprüfung (`frontend/.../utils/guenstiger-pruefung.ts`)

Decides **einreichen (submit)** vs **selbst_zahlen (self-pay)**. Submitting is worthwhile when:

```
R − S  >  NPV(ΔBRE) − Steuervorteil(R)
```

where `R` = reimbursable amount, `S` = remaining annual Selbstbehalt (deductible), `NPV(ΔBRE)` = present value of the premium-refund lost by breaking the leistungsfrei (claim-free) streak, discounted to today (default rate 3% p.a.), and `Steuervorteil` = tax saving from self-paying. See §5 of the design doc for the reference implementation and the breakdown fields the UI expects.

## Backend REST surface (planned)

`/api/contracts`, `/api/invoices` (full CRUD), plus `/api/invoices/:id/submit`, `/api/invoices/:id/refund`, `/api/stats/year/:year`, `/api/stats/bre/:contractId`, and `/api/export/db` + `/api/import/db` for SQLite backup/restore. Auth is intentionally minimal (reverse-proxy Basic Auth, or optional `X-API-Key` for VPN access) — see §7.2.

## Conventions

- Validate API payloads and forms with Zod.
- Date/BRE-streak math uses `date-fns`.
- OCR must not block the UI thread — always run it in a Web Worker.
- Keep the GOÄ/GOZ lookup tables as static, versioned JSON, regenerated reproducibly from the official source XML under `data/input/`. They are maintained exclusively by the maintainer (@justb81); errors can be reported as issues, and external PRs (code, data, or otherwise) are welcome but must be reviewed and merged by the maintainer.

## Repository hygiene & change policy

- **No outdated content in the repo.** Code, docs, comments, examples, and configuration must always reflect the current state. When you change something, update everything it touches in the same change — never leave stale references, dead code, obsolete docs, or superseded files behind. If you find existing content that is out of date, fix or remove it.
- **No backward-compatibility guarantee by default.** When changing an interface, API, schema, data format, or config, prefer the clean, correct result over preserving the old shape. Do not add compatibility shims, deprecation layers, dual-path handling, or migration fallbacks unless backward compatibility is explicitly requested. Update all call sites and consumers directly instead.
