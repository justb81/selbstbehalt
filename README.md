<p align="center">
  <img src="assets/selbstbehalt-logo.svg" alt="selbstbehalt logo" width="120" />
</p>

<h1 align="center">selbstbehalt</h1>

<p align="center">
  Self-hostable, privacy-first manager for German private health insurance (PKV).
</p>

<p align="center">
  <img src="assets/selbstbehalt-hero.png" alt="selbstbehalt" width="640" />
</p>

---

> **Status:** Early development. The complete technical and functional specification lives in [`docs/design.md`](docs/design.md) (German) and is the single source of truth. Application code is still being scaffolded.

## What it does

Privately insured people in Germany juggle several administrative tasks for which no complete, privacy-compliant, self-hostable tool exists. **selbstbehalt** ("deductible") covers three of them:

- **Manage contracts** — keep multiple PKV contracts (full coverage, supplementary tariffs, Beihilfe) in one place.
- **Capture & check invoices** — scan doctor invoices, parse the line items against the GOÄ/GOZ/GOT fee schedules, and flag charges whose Steigerungsfaktor (multiplier) exceeds the legal limits (§5 GOÄ).
- **Günstigerprüfung** — decide, per invoice, whether to **submit it to the insurer** or **self-pay** to preserve your Beitragsrückerstattung (BRE, premium refund) — comparing the net reimbursement against the present value of the refund you'd forfeit by breaking your claim-free streak.

## Design principles

- **Privacy by design** — sensitive health data (invoice images, diagnoses) never leaves your device unencrypted. OCR runs entirely client-side in the browser.
- **Offline-first** — core data is available without an active server connection.
- **Minimal server** — the backend is only a persistent database and REST API. No AI/LLM workloads server-side (~128 MB RAM, no GPU).
- **DSGVO-compliant** — full self-hostability means no transfer of Art. 9 health data to third parties.

## Architecture

A pnpm monorepo with two workspaces:

- **`frontend/`** — SvelteKit (Svelte 5, TypeScript) Progressive Web App. Installable on Android/desktop, offline-capable. OCR runs in a Web Worker via PaddleOCR.js (PP-OCRv5) with WebGPU + WASM fallback.
- **`backend/`** — Hono (TypeScript) REST API on port 8080, backed by SQLite via Drizzle ORM.

Deployed via Docker Compose, intended for a home network (Proxmox LXC / NAS) with optional VPN access.

```
Browser PWA  ──(JSON metadata only, no images)──>  REST API  ──>  SQLite
   │
   └── Camera → client-side OCR → GOÄ parser → Günstigerprüfung
```

See [`docs/design.md`](docs/design.md) for the full data model, REST surface, OCR pipeline, and the Günstigerprüfung formula.

## License

[Apache License 2.0](LICENSE).
