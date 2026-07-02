# Privacy-by-Design & DSGVO review — threat model + data-flow audit (issue #32)

A whole-system privacy/security review against the non-negotiable design
principles in [`docs/design.md`](design.md) §1.3 (Designprinzipien), §4
(client-seitige OCR) and §8 (Sicherheit & Datenschutz). It documents the proof
that

- invoice **images never leave the device** — only structured JSON metadata is
  sent to the backend,
- **no third-party resources are loaded at runtime** (no CDN, analytics or
  external fonts), and
- **data-subject rights** (erasure per Art. 17, portability per Art. 20) are
  implemented and tested for every entity,

then records the threat model and the Art.-9 processing overview.

This is the audit companion to the deployment-security guide
([`docs/hardening.md`](hardening.md), issue #31) and the automated supply-chain
tooling (issue #6, summarised in [`SECURITY.md`](../SECURITY.md)). File
references point at symbols/functions rather than line numbers so they don't go
stale as the code moves.

> **Scope of "the device".** selbstbehalt is self-hosted: the browser (PWA) and
> the backend both run on infrastructure the user controls. "Leaves the device"
> here means the browser→backend HTTPS boundary and, more importantly, any
> boundary to a *third party*. The design goal is that health data (Art. 9
> DSGVO) never reaches a party other than the user, and that the most sensitive
> artefact — the raw invoice image — never even reaches the user's own backend.

---

## 1. Data-flow audit — only structured JSON metadata leaves the browser

**Verdict: CONFIRMED.** Invoice images never cross the browser→backend
boundary. Every write to the backend is JSON (metadata + GOÄ positions); the
one exception is the user-initiated SQLite backup/restore, which is a whole-DB
file that by construction contains no image data.

### 1.1 The client → backend boundary is JSON-only

- The single transport is the typed API client
  (`apps/frontend/src/lib/api/client.ts`). It serialises **only** with
  `JSON.stringify` and sets `Content-Type: application/json`; there is no
  `FormData`/`Blob`/`File` branch on the invoice path. An `ImageData`/`Blob`
  passed by mistake could not even survive `JSON.stringify` intact — the type
  system and the serializer both preclude it.
- The invoice resource
  (`apps/frontend/src/lib/api/resources.ts`, `invoices.create`) sends an
  `InvoiceCreatePayload` — the metadata-only type defined in
  `packages/shared/src/schemas/invoice.ts`.
- The backend accepts the payload with `parseJsonBody(c, invoiceCreatePayloadSchema)`
  (`apps/backend/src/routes/invoices.ts`, `POST /`). It reads a JSON body only —
  no multipart, no file handling. The only file I/O anywhere under
  `apps/backend/src/routes/` is `backup.ts` (SQLite import/export), which
  rejects anything that is not a SQLite database by its magic bytes.

### 1.2 The invoice payload has no image field, at any layer

`invoiceCreateSchema` (`packages/shared/src/schemas/invoice.ts`) is `.strict()`
and whitelists exactly: `insured_person_id`, `invoice_date`, `invoice_number`,
`provider_name`, `provider_type`, `total_amount`, `status`, `file_path`,
`ocr_raw`, `notes`, plus `positions`. `.strict()` rejects any field outside
this list. The client builders agree:

- `InvoiceForm.svelte` (`FormPayload`, `handleSubmit`) sends only metadata +
  `ocr_raw` (recognised **text**) + positions.
- `toInvoicePayload` in
  `packages/medic-invoice-check/src/lib/ocr/scan-flow.ts` builds the POST body
  from a `ReviewState`; those types carry `ocrText`/`positions` and no
  `ImageData`/canvas/dataURL/File/Blob field. Header comment: *"only recognised
  text and structured metadata travel through these helpers — never the
  image."*
- `apps/backend/src/db/schema.ts` `invoices` and every other table have **no
  BLOB and no image column**. `file_path` is a `text` path *reference* (for the
  optional on-disk PDF volume, §7.3), not image binary; `ocr_raw` is text.

### 1.3 OCR keeps the image in the browser/worker and discards it

The pixels never reach the API layer, let alone the network:

1. `capture.ts` decodes camera/file/PDF input to an in-memory `ImageData`
   on-device (no network).
2. `preprocess.ts` runs pure in-memory pixel transforms.
3. `ocr-client.ts` **transfers** (zero-copy) the pixel buffer *into* the Web
   Worker (`transfer: [image.data.buffer]`) — into another thread in the same
   process, not out to any socket.
4. `ocr-worker-core.ts` / `ocr.worker.ts` run recognition and `postMessage`
   back **only** `OcrResult[]` = `{ text, bbox, confidence }`. No response type
   carries pixels (`packages/medic-invoice-check/src/lib/ocr/types.ts`). The
   worker performs no network I/O.
5. `OCRScanner.svelte` (`processImages`) holds each frame in a loop-local and
   drops it as soon as `onScanned(...)` returns — no field, no store. Comment:
   *"Frames are discarded as soon as recognition finishes (Datenminimierung
   §8.2)."* The camera stream is torn down on capture/destroy.

### 1.4 Offline queue and PWA share-target stay local

- The offline write-queue (`apps/frontend/src/lib/offline/queue.ts`,
  `store-indexeddb.ts`) persists `QueuedWrite` records whose `body` is the same
  metadata JSON the API client would have sent — never image bytes — and
  replays them on reconnect.
- The PWA **share target** (`apps/frontend/src/lib/pwa/share-target.ts`,
  `service-worker.ts`) intercepts an inbound shared PDF *before* it can hit the
  network, stores it in Cache Storage only, hands it to the client-side OCR
  scanner, then deletes it. Only the extracted metadata is later POSTed.

### 1.5 End-to-end regression guard

`apps/frontend/e2e/scan.spec.ts` drives a real scan → review → save and then
asserts the privacy invariant on the actual POST body:

```
// Privacy: only metadata is sent — no image, no raw file (§8.2).
expect(posted.ocr_raw).toBe(OCR_TEXT);
expect(posted).not.toHaveProperty('file_path');
```

So a future change that tried to attach image data to the save payload would
fail CI.

---

## 2. Network audit — no third-party resources at runtime

**Verdict: CONFIRMED / CLEAN.** Every runtime resource — OCR models, ONNX
Runtime WASM, the pdf.js worker, fonts, styles, scripts, the manifest and icons
— is served same-origin/on-device. The only external URLs in the tree are in
build-time scripts, comments, test fixtures, an HTML input placeholder and a
sentinel cache key; none is a runtime network call.

### 2.1 Content-Security-Policy pins everything to `'self'`

Frontend (`apps/frontend/security-headers.conf`, generated by
`scripts/generate-frontend-security-headers.mjs` at build time and exercised by
`apps/frontend/e2e/csp.spec.ts`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' <build-hash>;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self'; worker-src 'self'; child-src 'self'; manifest-src 'self';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none';
upgrade-insecure-requests
```

- `connect-src 'self'` — the decisive line: no `fetch`/XHR/WebSocket to any
  external origin is permitted at runtime.
- `font-src 'self'`, `default-src 'self'` — no external fonts or fallback
  origins.
- Documented, minimal relaxations only: `'wasm-unsafe-eval'` for the on-device
  OCR's WebAssembly runtime (not the broader `'unsafe-eval'`); a build-generated
  SHA-256 hash for SvelteKit's own inline init script (not `'unsafe-inline'`,
  not a wildcard); `'unsafe-inline'` in `style-src` only for a couple of
  shadcn-svelte primitives' dynamic inline `style` attributes; `data:`/`blob:`
  in `img-src` for canvas-rendered previews. Each is annotated in the file
  itself. `Permissions-Policy` grants `camera=(self)` for the scanner and
  disables everything else (including `interest-cohort=()`).

Backend (`apps/backend/src/app.ts`, `hono/secure-headers`): `default-src 'none'`
(API is JSON-only). `Cross-Origin-Resource-Policy: cross-origin` is relaxed
solely to support the optional separate-origin backend deployment (§7.2);
access control stays with `CORS_ORIGINS` + the API-key/reverse-proxy auth, not
with CORP.

### 2.2 OCR models + ONNX WASM are served locally, never from a CDN

- `packages/medic-invoice-check/src/lib/ocr/types.ts` (`OCR_ASSET_PATHS`,
  `resolveOcrAssets`) resolves model/dictionary/WASM URLs to same-origin paths
  under `/models/ocr/**` and `/models/ort/**` — never the `ppu-paddle-ocr` CDN
  defaults.
- `engine.ts` (`defaultLoadModule`) sets `ort.env.wasm.wasmPaths` to the local
  path **before** importing the binding and passes the local model URLs into
  `PaddleOcrService`, overriding the binding's built-in CDN defaults.
- Build steps bake these assets into the image locally: `scripts/copy-ort-wasm.mjs`
  copies the ONNX Runtime WASM from the local `onnxruntime-web` package into
  `static/models/ort/`; `pnpm ocr:models` (`scripts/fetch-ocr-models.mjs`)
  populates `static/models/ocr/` with SHA-256-pinned model files at build time.
- The service worker (`@vite-pwa/sveltekit` in `injectManifest` mode) precaches
  only same-origin build assets (`globIgnores: ['**/models/**']` keeps the large
  models out of precache; they are `cacheFirst`-cached on first use). Its
  request classifier (`apps/frontend/src/lib/pwa/strategies.ts`) leaves every
  cross-origin request untouched (returns `null`) — there is no blanket
  cross-origin caching.

### 2.3 No analytics / telemetry / error-reporting SDKs

The runtime `dependencies` of `apps/frontend`, `packages/medic-invoice-check`
and `apps/goae-waechter` contain no analytics/telemetry/error SDK. The only
network-capable runtime deps are the OCR/PDF engines (`onnxruntime-web`,
`ppu-paddle-ocr`, `pdfjs-dist`), all pointed at local assets. Lighthouse, axe,
workbox-build and vite-plugin-pwa are devDependencies (build/test only). The
supply chain itself is guarded by CodeQL, `pnpm audit`, license checks, SBOM and
Dependabot (see [`SECURITY.md`](../SECURITY.md)).

### 2.4 External-origin references, classified

| Where | Reference | Classification |
|---|---|---|
| `scripts/fetch-ocr-models.mjs` | `media./raw.githubusercontent.com` | Build-time model fetch, SHA-256-pinned. Not shipped. |
| `apps/frontend/src/lib/pwa/share-target.ts` | `https://share-target.invalid/…` | Sentinel Cache-Storage key (RFC 6761 `.invalid`); never fetched. |
| `apps/frontend/src/lib/api/client.ts` | `http://localhost` | SSR/test `new URL()` fallback; real requests use `location.origin`. |
| `apps/frontend/src/routes/settings/+page.svelte` | `https://backend.example.com` | Input *placeholder* text for the optional separate-origin backend URL. |
| `packages/medic-invoice-check/.../engine.ts`, `types.ts`, model `README.md` | "CDN" mentions | Comments/docs explaining the local-override. |
| `*.test.ts` | `http://api.test`, `https://cdn.example`, … | Test fixtures; `strategies.test.ts` asserts a cross-origin URL is **not** cached. |

Zero runtime leaks.

---

## 3. Data minimisation (§8.2)

- **Images are discarded after OCR** and never uploaded (§1.3). There is no
  code path that persists or transmits the invoice image.
- The only opt-in retention is the **recognised text** (`ocr_raw`), saved by
  default so the user can re-parse later and opt-out-able via the checkbox in
  `InvoiceForm.svelte`. This matches the §8.1 row "OCR-Rohtxt | Client →
  optional Backend | opt-in". It is text, not an image.
- The optional on-disk PDF volume (`file_path`, §7.3) is a *deployment* option;
  no client code populates `file_path` today, and the E2E guard asserts it is
  absent from the save payload (§1.5).
- Only structured, minimally-necessary fields are stored (metadata + GOÄ
  positions needed for the Erstattungs-/Günstigerprüfung).

---

## 4. Data-subject rights — erasure (Art. 17) and portability (Art. 20)

### 4.1 Erasure: a DELETE path for every entity, cascading with no orphans

Foreign-key cascade enforcement is turned **on for every connection** —
`sqlite.pragma('foreign_keys = ON')` in `createDb()`
(`apps/backend/src/db/client.ts`). Without it SQLite silently ignores the
`ON DELETE CASCADE` clauses, so this pragma is load-bearing; the person-erasure
test (below) fails if it is ever removed.

| Entity | DELETE route | How its children are erased | Tested |
|---|---|---|---|
| `persons` | `DELETE /api/persons/:id` | Cascade **two** ways: `contracts.policyholder_id` and `insured_persons.person_id` → transitively everything below | **Yes** — `persons.test.ts` |
| `contracts` | `DELETE /api/contracts/:id` | `insured_persons.contract_id` → invoices → positions/status-events/submissions; + bre_periods | **Yes** — `contracts.test.ts`, `schema.integration.test.ts` |
| `insured_persons` | `DELETE /api/insured/:id` | `invoices.insured_person_id`, `bre_periods.insured_person_id` | **Yes** — `insured.test.ts`, integration |
| `invoices` | `DELETE /api/invoices/:id` | `invoice_positions`, `invoice_status_events`, `submissions` | **Yes** — `invoices.test.ts`, integration |
| `invoice_positions` | via invoice cascade | `ON DELETE CASCADE` from `invoices` | integration |
| `invoice_status_events` | via invoice cascade | `ON DELETE CASCADE` from `invoices` | integration |
| `submissions` | via invoice cascade | `ON DELETE CASCADE` from `invoices` | integration |
| `bre_periods` | via insured cascade | `ON DELETE CASCADE` from `insured_persons` | integration |

The child/audit tables (positions, status-events, submissions, BRE periods) are
intentionally removed only via cascade — they carry no independent identity and
are meaningless without their parent. The cascade FKs are declared in
`apps/backend/src/db/schema.ts` and materialised in the migration SQL
(`ON DELETE cascade`).

`persons` is the DSGVO identity root — the entity an Art. 17 erasure request
targets — so its cascade is the most important, and until this review it was the
only DELETE route with **no test at all**. `apps/backend/src/routes/persons.test.ts`
(added here) exercises the full dual-path erasure end-to-end: a person who is
both a policyholder *and* insured on a *second* person's contract is deleted
through `DELETE /api/persons/:id`, and the test asserts that (a) their contract,
insured rows, invoices, positions, status-events, submissions and BRE periods
are all gone across every table, and (b) the other person's contract, insured
row and invoice survive untouched (no over-deletion).

### 4.2 Portability: whole-database export/import (round-trip verified)

`apps/backend/src/routes/backup.ts`:

- `GET /api/export/db` streams a consistent snapshot of the entire SQLite
  database (`serialize()`) as a download — a complete, portable copy of all the
  user's data.
- `POST /api/import/db` validates the upload (size, SQLite magic bytes,
  `integrity_check`, per-table column-signature match), snapshots the current DB
  to a `.bak-<ts>` file, then atomically reloads the app tables inside one
  transaction with a final `foreign_key_check` that rolls back on any violation.
  It is double-guarded by a required `?confirm=true`.

**Defect found and fixed in this review.** The reload's `APP_TABLES` list
omitted `invoice_status_events`. Consequences: (1) the invoice status-event
audit trail was silently dropped on every import — an Art. 20 completeness gap
against the export, which *does* include it; and (2) importing into any
API-populated database left the target's own status-event rows dangling (their
parent invoices were cleared and re-inserted with new IDs), so the final
`foreign_key_check` failed with a 422 and the whole import was refused. The
round-trip test masked both because its seed helper inserted rows directly and
never created a status event, unlike every API-created invoice. `APP_TABLES` now
includes `invoice_status_events`, and `backup.test.ts` seeds a status event and
adds a dedicated test asserting the audit trail round-trips without orphaning the
target (it fails against the old code with the 422).

---

## 5. §8.1 data-category reconciliation

Each row of the design doc's data-category table (§8.1), checked against the code:

| Datenkategorie | Soll (§8.1) | Ist (verified) |
|---|---|---|
| Rechnungsbilder (Fotos/Scans) | Nur Client | ✅ Never leaves the browser; discarded after OCR (§1, §3). No image column exists; E2E-guarded. |
| OCR-Rohtext | Client → optional Backend (opt-in) | ✅ `ocr_raw` text column; opt-out checkbox in `InvoiceForm`. No image. |
| Strukturierte Rechnungsdaten (JSON) | Backend (SQLite), keine Bilder | ✅ `invoices` + `invoice_positions`: metadata/numeric/text only. |
| GOÄ-Ziffern & Beträge | Backend (SQLite) | ✅ In `invoice_positions`; GOÄ lookup tables are static local JSON. |
| Vertragsangaben | Backend (SQLite) | ✅ `contracts`, `insured_persons`. |

No category is stored anywhere the table doesn't allow; images are stored
nowhere at all.

---

## 6. Threat model

### 6.1 Assets (by sensitivity)

1. **Invoice images** (most sensitive; Art. 9) — raw scans/photos, may contain
   diagnoses/free text.
2. **Structured health-adjacent data** (Art. 9) — provider, GOÄ codes,
   `ocr_raw`, amounts, submission/refund history.
3. **Contract & identity data** — person names, birth dates, KVNR, insurer,
   tariff, premium.
4. **The database at rest** — the aggregate of all of the above, plus exported
   backups.

### 6.2 Trust boundaries

- **Browser ↔ third parties** — the boundary the design forbids crossing.
  Enforced by CSP (`connect-src 'self'`), the local-only OCR/model hosting and
  the no-analytics dependency posture (§2). Images never even reach asset #4.
- **Browser ↔ self-hosted backend** — JSON metadata only; HTTPS mandatory
  (§7.2); authenticated by reverse-proxy Basic Auth (single-origin) or
  `X-API-Key` (separate-origin).
- **Backend ↔ disk** — SQLite file (+ optional PDF volume) on the host the user
  controls.

### 6.3 Adversaries and threats

| Adversary | Threat | Mitigation |
|---|---|---|
| Network eavesdropper / MITM | Intercept health data in transit | HTTPS mandatory (§7.2, [`hardening.md`](hardening.md)); `upgrade-insecure-requests`; HSTS. |
| A malicious/compromised third-party origin | Exfiltrate images or data via a CDN/analytics beacon | No third-party runtime deps; CSP `connect-src/font-src/default-src 'self'` blocks egress; images stay client-side (§1, §2). |
| A supply-chain-compromised dependency | Inject an exfiltration call | CSP blocks the network egress at runtime; CodeQL/`pnpm audit`/SBOM/Dependabot guard the chain (#6). |
| Unauthenticated LAN/Internet caller | Read or modify data via the API | Reverse-proxy Basic Auth / `X-API-Key`; `CORS_ORIGINS` must be a specific list, never `*`, when a key is set. |
| Data-subject request | Cannot erase or export their data | Per-entity cascade DELETE + whole-DB export/import, tested (§4). |
| Host/backup thief | Read the SQLite file or an exported backup | Residual risk — DB is unencrypted SQLite; see §8. Mitigate with disk/volume encryption; optional SQLCipher (§8.2). |
| XSS in the SPA | Steal a session / act as the user | Strict CSP (no third-party/inline scripts beyond the build-hashed init); `object-src/base-uri 'none'`; SvelteKit output encoding. |
| Clickjacking | Frame the app to trick actions | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (both services). |

### 6.4 Residual risks (see §8 for the full list)

- SQLite and exported backups are **unencrypted at rest** by default.
- `file_path`/`ocr_raw` are `z.string()` columns the backend would accept even
  though no client populates them — a defence-in-depth hardening opportunity,
  not a live leak (E2E-guarded absent).

---

## 7. DSGVO processing overview (Verarbeitungsübersicht, Art. 9)

Because selbstbehalt is **self-hosted for personal/household use**, the operator
is typically also the data subject and there is **no transfer to any third
party or processor**. This overview documents the processing for completeness
and for anyone deploying it for family members.

| Aspekt | Beschreibung |
|---|---|
| Verarbeitungszweck | Verwaltung privater Krankenversicherungsverträge; Prüfung von Arztrechnungen (GOÄ/GOZ/GOT); Günstigerprüfung (einreichen vs. selbst zahlen). |
| Betroffene Kategorien | Versicherungsnehmer und versicherte Personen (ggf. Familienangehörige). |
| Datenkategorien | Identitäts-/Vertragsdaten; **Gesundheitsdaten (Art. 9)**: Arztrechnungsinhalte, GOÄ-Ziffern, ggf. OCR-Rohtext; Rechnungsbilder ausschließlich flüchtig im Browser. |
| Rechtsgrundlage | Für den Eigengebrauch greift die Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO); bei Verwaltung für Dritte: Einwilligung nach Art. 9 Abs. 2 lit. a. |
| Verarbeitungsort | Ausschließlich Gerät des Nutzers (Browser) + selbst gehosteter Backend-Server. **Keine Übermittlung an Dritte** (§1.3 Nr. 4). |
| OCR/KI | 100 % client-seitig; keine serverseitige KI, kein externer LLM-Aufruf (Standard). |
| Empfänger | Keine. Optional: die eigene Versicherung bei manueller Einreichung durch den Nutzer (außerhalb der App). |
| Speicherdauer | Bis zur Löschung durch den Nutzer (Art. 17). Bilder: sofort nach OCR verworfen. |
| Betroffenenrechte | Auskunft/Portabilität via DB-Export (Art. 15/20); Löschung via kaskadierendem DELETE je Entität (Art. 17) — siehe §4. |
| TOMs | Client-seitige OCR; strikte CSP ohne Drittanbieter; HTTPS-Pflicht; Reverse-Proxy-Auth / `X-API-Key`; kaskadierende Löschung; optional Verschlüsselung at rest. |

---

## 8. Security-review checklist

Design-principle and DSGVO items verified in this review:

- [x] Only structured JSON metadata leaves the browser; images never do (§1),
      E2E-guarded (`scan.spec.ts`).
- [x] No third-party runtime resources — CSP `connect-src/font-src 'self'`, no
      CDN/analytics, models + WASM served locally (§2), CSP e2e-guarded
      (`csp.spec.ts`).
- [x] Images discarded after OCR; only opt-in `ocr_raw` **text** persists (§3).
- [x] Per-entity DELETE cascade with no orphans; FK enforcement on at runtime
      (§4.1) — now tested for `persons` too.
- [x] Whole-DB export + validated, transactional import for portability; the
      `invoice_status_events` round-trip gap fixed and tested (§4.2).
- [x] §8.1 data categories reconciled against the code (§5).
- [x] Threat model + Art.-9 processing overview documented (§6, §7).

Deployment-time items live in the operator checklists, not here — before
exposing an instance work through [`SECURITY.md`](../SECURITY.md) and
[`docs/hardening.md`](hardening.md):

- [ ] HTTPS reverse proxy with HTTP Basic Auth in front of the app.
- [ ] `PKV_API_KEY` set iff the backend is on its own origin; `CORS_ORIGINS`
      a specific list, never `*`.
- [ ] Backups/DB encrypted at rest if stored off-host (unencrypted SQLite by
      default; optional SQLCipher, §8.2).
- [ ] Secret scanning + push protection enabled on the repository.

## 9. Recommendations / follow-ups

- **Constrain or drop `file_path`** on the invoice write path (it is a
  `z.string()` the backend accepts but no client sets) to make "no image bytes
  in the DB" a hard schema guarantee rather than a convention. Tracked as a
  hardening follow-up, not a live leak.
- **Encryption at rest** (SQLCipher) remains optional (§8.2) — recommend it, or
  disk/volume encryption, for any instance whose host or backups are not
  physically trusted.
