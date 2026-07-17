# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The monorepo scaffolding and most of the Phase 0/1 foundation are in place. Implemented so far:

- **`packages/shared/`** — the cross-package source of truth: Zod schemas + inferred types for every entity, shared enums, and the BRE ladder helpers.
- **`packages/medic-invoice-check/`** (`@selbstbehalt/medic-invoice-check`) — the framework-light, backend-free scan-and-check engine shared by `apps/frontend` and the planned GOÄ-Wächter demo (issues #166/#169): the on-device OCR pipeline (**PP-OCRv5 via `ppu-paddle-ocr`**, ONNX Runtime, Web Worker, WebGPU/WASM, behind an injectable engine seam bundled into a worker-only chunk), a PDF text-layer-first path (`ocr/pdf.ts` — `pdfjs` `getTextContent()` per page, with a quality heuristic falling back to rasterise-+-OCR only for pages whose text layer is missing or unusable, issue #278), the GOÄ/GOZ/GOT fee-schedule data + parser (full rule validation — §5 Steigerungsfaktor limits, plus the cross-Ziffer constraint model: exclusions, required base services, Höchstwert amount caps, frequency/duration/age limits), and the reusable scan + review UI (`OCRScanner`, `InvoiceReview` — reduced Rechnungskopf + GOÄ/GOZ position table with hints/warnings, no tariff-dependent `eligible_amount`). The one remaining OCR step is verifying the WebGPU path + WASM fallback in a real browser (#27).
- **`apps/backend/`** — Hono REST API on SQLite via Drizzle: DB schema + migrations, and the `contracts`, `insured`, `invoices`, `stats` and backup (export/import) routes, with API-key auth middleware.
- **`apps/frontend/`** — SvelteKit app shell + typed API client, the Günstigerprüfung engine, the tariff-based Erstattungs-Engine, the `/stats` Jahresauswertung (year selector, Kosten-vs-Erstattungen and BRE-Verlauf charts via `layerchart`, no CDN — issue #28), and the PWA layer (web app manifest + icons, service worker with the §6.3 caching strategies, and an offline write-queue replayed on reconnect — via `vite-plugin-pwa`). The invoice capture/review UI comes from `@selbstbehalt/medic-invoice-check`; `InvoiceForm` wraps `InvoiceReview` with person selection, notes, the `eligible_amount` reimbursement, and saving. Most other UI pages (contracts/invoices/dashboard/settings) are still thin. The OCR models and the ONNX-Runtime WASM are served on-device under `/models/**` (`pnpm ocr:models` + `scripts/copy-ort-wasm.mjs`, baked into the Docker build; never a CDN at runtime). See `docs/roadmap.md` and the open GitHub issues.

Reference material:

- `docs/design.md` — the complete technical and functional specification (German). This is the single source of truth; follow it when implementing.
- `docs/roadmap.md` — the phased implementation plan, mirroring the GitHub issues (phases, dependencies, label scheme).
- `data/input/{goae,goz,got}/*.xml` — the official gesetze-im-internet.de legal-text exports of the GOÄ/GOZ/GOT fee schedules; build inputs from which the parser's JSON lookup tables are generated (not hand-maintained).

### Commands

Run from the repo root (pnpm workspaces); each fans out to the packages:

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — CI gate (also `pnpm test:e2e` for Playwright).
- `pnpm format:check` / `pnpm format` — Prettier.
- `pnpm --filter @selbstbehalt/backend db:generate` / `db:migrate` / `db:seed` — Drizzle migrations + seed data.
- `pnpm fees:build` / `pnpm fees:validate` — regenerate/validate the fee-schedule JSON from the source XML.

## What this is

**selbstbehalt** (working title "PKV Manager") is a self-hostable, privacy-first Progressive Web App for managing German private health insurance (PKV). Three core jobs:

1. Manage multiple PKV contracts (Vollversicherung, Zusatztarife, Beihilfe).
2. Capture, parse, and validate doctor invoices (GOÄ/GOZ/GOT fee schedules).
3. Run the **Günstigerprüfung** — decide whether to submit an invoice to the insurer or self-pay to preserve the Beitragsrückerstattung (BRE, premium refund) streak.

The domain is German and insurance-specific. Keep entity/field names in German where the design doc uses them (e.g. `selbstbehalt`, `bre_structure`, `eligible_amount`); UI text is German (`de-DE`).

## Architecture (planned)

Monorepo via **pnpm workspaces** — `apps/frontend/`, `apps/backend/`, and `packages/shared/` (shared Zod schemas, types and domain helpers).

- **Frontend**: SvelteKit (Svelte 5, TypeScript) PWA. Installable, offline-first.
- **Backend**: Hono (TypeScript) REST API on port 8080, SQLite via Drizzle ORM. Minimal — it is *only* a database + REST layer. No AI/LLM workloads server-side ever.
- **OCR**: runs entirely client-side (PP-OCRv5 via `ppu-paddle-ocr` on ONNX Runtime) in a **Web Worker** with WebGPU + WASM fallback. Invoice images never leave the device.
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
Person (1) ── (n) Vertrag (contract, as Versicherungsnehmer / policyholder)
Vertrag (1) ── (n) VersichertePerson (insured person on the contract, own KVNR)
Person (1) ── (n) VersichertePerson (a person may be insured on several contracts)
VersichertePerson (1) ── (n) Rechnung (invoice)
Rechnung (1) ── (n) Rechnungsposition (invoice line / GOÄ code)
Rechnung (1) ── (1) Einreichung (submission, optional)
VersichertePerson (1) ── (n) BRE-Periode (premium-refund period)
```

A `contract` (Hauptvertrag) holds only insurer/contract number and its `policyholder_id`. Each insured person sits in `insured_persons` and carries its own `kvnr` (Krankenversichertennummer), `tariff_name`, `monthly_premium`, `self_retention`, `bre_structure`, and `included_benefits`. Invoices and BRE periods reference the **insured person**, not the contract.

Tables: `persons`, `contracts`, `insured_persons`, `invoices`, `invoice_positions`, `submissions`, `bre_periods`. IDs are UUIDs (TEXT PK). Money is stored as `REAL` in EUR. `bre_structure` and `included_benefits` are JSON stored as TEXT.

## Two domain-critical algorithms

These hold the actual business value — get them right and keep them well-tested.

### 1. GOÄ invoice parser (`packages/medic-invoice-check/.../utils/goae-parser.ts`)

German doctor invoices follow the legally-defined GOÄ schema (§12 GOÄ). The parser regex-extracts line items, looks each GOÄ code up in a static JSON table (the versioned tables under `packages/medic-invoice-check/src/lib/data/{goae,goz,got}.json`, ~4500 codes across GOÄ/GOZ/GOT), and validates it against every rule the fee schedule defines for that code — not just the Steigerungsfaktor (multiplier):

- **§5 Steigerungsfaktor** — billed multiplier against the legal limit for the category: default (personal services) 2.3, technical 1.8, lab (Teil M) 1.15, inpatient 1.8. Some Ziffern instead have a fester Gebührensatz (fixed factor) that must match exactly.
- **Cross-Ziffer constraints**, checked across the whole invoice: `excludes`/mutual exclusion (codes that may not be billed together), `requires` (a surcharge billed without its base service), `componentOf` (a code already included in another billed code), `maxFrequency` (per session/day/case/occasion/year/lifetime), `maxAmount`/Höchstwert (a Euro cap summed across a code group), `minDuration`, and `ageLimit`.

A violation of any of these is flagged (`is_valid = false`, with `flag_reason`). The GOÄ lookup tables are version-controlled static JSON — no LLM needed; GOÄ is public.

### 2. Günstigerprüfung (`apps/frontend/.../utils/guenstiger-pruefung.ts`)

Decides **einreichen (submit)** vs **selbst_zahlen (self-pay)**. Submitting is worthwhile when:

```
R − S  >  NPV(ΔBRE) + Steuervorteil(R)
```

where `R` = reimbursable amount, `S` = remaining annual Selbstbehalt (deductible), `NPV(ΔBRE)` = present value of the premium-refund lost by breaking the leistungsfrei (claim-free) streak, discounted to today (default rate 3% p.a.), and `Steuervorteil` = tax saving from self-paying. See §5 of the design doc for the reference implementation and the breakdown fields the UI expects.

## Backend REST surface (planned)

`/api/persons`, `/api/contracts`, `/api/contracts/:id/insured` + `/api/insured/:id`, `/api/invoices` (full CRUD), plus `/api/invoices/:id/submit`, `/api/invoices/:id/refund`, `/api/stats/year/:year`, `/api/stats/bre/:insuredPersonId`, the positions roll-up per Leistungsjahr `/api/stats/positions/:insuredPersonId` (#239 — `R_Y = eligible_amount + refund_amount`, `alreadyReimbursed = refund_amount`; feeds the Günstigerprüfung KPIs), and `/api/export/db` + `/api/import/db` for SQLite backup/restore. Auth is intentionally minimal (reverse-proxy Basic Auth, or optional `X-API-Key` for VPN access) — see §7.2.

## Conventions

- **UI-Standard: shadcn-svelte + Tailwind CSS v4 (verbindlich)** — Alle UI-Komponenten und Seitenelemente verwenden ausschließlich shadcn-svelte-Komponenten (`$lib/components/ui/`) und Tailwind-CSS-Utilities. Kein Custom-CSS, keine `<style>`-Blöcke in `.svelte`-Dateien, keine eigenen CSS-Klassen für Layout, Karten, Tabellen, Buttons, Badges, Formulare oder Modals. Neue Elemente greifen auf [shadcn-svelte](https://shadcn-svelte.com/docs) zurück und erweitern bei Bedarf mit Tailwind-Klassen.
- Validate API payloads and forms with Zod.
- Date/BRE-streak math uses `date-fns`.
- OCR must not block the UI thread — always run it in a Web Worker.
- Keep the GOÄ/GOZ lookup tables as static, versioned JSON, regenerated reproducibly from the official source XML under `data/input/`. They are maintained exclusively by the maintainer (@justb81); errors can be reported as issues, and external PRs (code, data, or otherwise) are welcome but must be reviewed and merged by the maintainer.

## Working notes (verified gotchas)

Hard-won specifics that save a round-trip next time:

- **Invoice lifecycle = three derived tracks, not one status column.** `invoices` has **no** `status` column: the state is `review` (`neu`↔`geprüft`), `payment` (`offen`↔`bezahlt`) and `submission` (`nicht_eingereicht`→`eingereicht`→`erstattet`), each **derived** as the latest event per track from the append-only `invoice_status_events` (which now carries a `track`). Payment and submission are independent (reimbursement often precedes paying the doctor); both unlock at `review = geprüft`. The invoice DTO's `status` is the object `{review, payment, submission, paid_on}` (`paid_on` = date of the `bezahlt` event — there is no `paid_on` column). Backend derives via `deriveInvoiceStatus` (shared, order events by **rowid**, not `changed_at` — a payment event's `changed_at` carries the user-supplied Zahlungsdatum) for single reads and the `invoice_current_status` SQL view for list/stats filters. Endpoints: `POST /:id/review`, `POST /:id/payment`, `POST /:id/submit`, `PUT /:id/refund`, `POST /:id/submission/revert` (payment revert = `POST /:id/payment {status:'offen'}`). Edit-lock: paid **or** submitted. GP `aggregateByYear` ignores `review = neu` and reads `submission` for realised-vs-estimate.
- **Günstigerprüfung engine seam** (`apps/frontend/src/lib/utils/guenstiger-pruefung.ts`): reuse the engine, never re-implement the decision rule (§5.2 — "gemeinsame Quelle, keine Doppelrechnung"). `calculateGCP(...).breakdown.lostBREValue_NPV` is the *actual* NPV — **`0` below the Selbstbehalt or when the streak is already broken**. For the *potential* NPV (e.g. an `S + NPV` submit threshold drawn while still under S) call the exported `calculateBRELadderNPV(...)`. Get `R_Y` per Leistungsjahr from `aggregateByYear(invoices)` (client-side; needs invoices *with positions*) or the `/api/stats/positions/:id` roll-up. The everyday Ampel/KPI lives in `utils/selbstbehalt-radar.ts` + `components/SelbstbehaltRadar.svelte`; the retrospective verdict in `components/GCPCard.svelte` (consumed on `/insured/[id]`).
- **Leistungsbereich (`benefit_category`) je Position**: two axes, don't conflate them — `goae_category` (GOÄ/GOZ/GOT) is *which fee schedule*; `benefit_category` (`ambulant`/`zahnbehandlung`/`zahnersatz`/`kieferorthopaedie`/…) is *which tariff area* and alone drives the reimbursement %. A GOÄ position on a Zahnarzt/KFO invoice can legitimately be `zahnbehandlung`/`kieferorthopaedie`. Default per position = fee-table `benefitCategory`, else `defaultBenefitCategoryForProvider(provider_type)` (both in `@selbstbehalt/shared` `utils/benefit-category.ts`, with `BENEFIT_CATEGORY_LABELS`). `InvoiceReview` shows a per-position picker only under `showBenefitCategory` (on in `InvoiceForm`, off in the GOÄ-Wächter demo); a manual pick sets `benefit_category_overridden` so auto-revalidation won't stomp it, the ↺ button re-derives. The chosen value is persisted (`invoice_positions.benefit_category`) and, on reload, re-pinned. Save-time resolution + refund-time bucketing live in `apps/frontend/.../utils/benefit-category.ts` (`resolveBenefitCategory` is override-first; `benefitCategoryForPosition` is the legacy provider-type fallback).
- **Determinism**: domain utils take an injectable `asOf` (`DateInput`) — no hidden `Date.now()`. Use `toCalendarDate` / `currentLeistungsjahr` and thread `asOf` through in tests.
- **Coverage gate**: `src/lib/utils/**` must stay ≥ 90 % (statements/branches/functions/lines) — co-locate a `.test.ts` for every new util. Run `pnpm --filter @selbstbehalt/frontend test:coverage`.
- **a11y is enforced**: `apps/frontend/e2e/a11y.spec.ts` runs axe on `/`, `/stats`, `/insured/[id]`, `/invoices*`, `/contracts*`, `/persons*`, `/settings`. Any `role="progressbar"` needs an `aria-label` (else axe `aria-progressbar-name`). When a page starts calling a new endpoint, add a matching read-mock to `apps/frontend/e2e/fixtures.ts` (`mockBackend`) or the a11y/responsive specs go stale.
- **Links to pre-resolved hrefs**: put `<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->` directly above a **single-line** `<a {href} …>` (rule `svelte/no-navigation-without-resolve`). Keep the tag on one line — extract a long class list to a `const` so Prettier can't wrap it past the directive.
- **Commits**: commitlint enforces Conventional Commits with a **lowercase, non-sentence-case subject** (`feat(frontend): add …`, not `feat: Add …`). Husky runs `eslint --fix` + `prettier --write` on staged files at commit time.
- **e2e in this sandbox**: the pinned Playwright browser isn't installed; run specs with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm --filter @selbstbehalt/frontend exec playwright test <spec> --project=chromium`.

## Repository hygiene & change policy

- **No outdated content in the repo.** Code, docs, comments, examples, and configuration must always reflect the current state. When you change something, update everything it touches in the same change — never leave stale references, dead code, obsolete docs, or superseded files behind. If you find existing content that is out of date, fix or remove it.
- **No backward-compatibility guarantee by default.** When changing an interface, API, schema, data format, or config, prefer the clean, correct result over preserving the old shape. Do not add compatibility shims, deprecation layers, dual-path handling, or migration fallbacks unless backward compatibility is explicitly requested. Update all call sites and consumers directly instead.

## Issue & PR workflow

- **Tick off completed checkboxes.** When a change completes task checkboxes in the issue(s) it addresses, update the issue body to mark those boxes `- [x]` as part of the same work — don't leave finished tasks unchecked.
- **Auto-close issues from the PR.** When a PR fully resolves an issue, add a `Closes #<n>` line to the PR body so GitHub closes it on merge. List one `Closes #<n>` per fully-resolved issue. Use `Refs #<n>` (not `Closes`) for issues the PR only touches partially.
