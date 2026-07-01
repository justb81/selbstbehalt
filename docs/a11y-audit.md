# Accessibility audit (issue #29)

Status snapshot of the Phase 3 polish pass: automated axe-core coverage added
to the E2E suite, the concrete violations it found (and fixed), a Lighthouse
accessibility score, and what's explicitly deferred.

## Automated coverage

`frontend/e2e/a11y.spec.ts` runs an [`@axe-core/playwright`](https://www.npmjs.com/package/@axe-core/playwright)
scan (WCAG 2.0/2.1 A + AA rule sets) against every primary route and state,
using the shared backend mocks in `frontend/e2e/fixtures.ts` (this e2e project
has no live backend):

- Dashboard (`/`) — empty and populated
- Invoices list (`/invoices`) — empty and populated
- Invoice detail (`/invoices/:id`) — including the delete-confirmation dialog
- Invoice create form (`/invoices/new`) — including the OCR scanner panel open
- Invoice edit form (`/invoices/:id/edit`)
- Scan route redirect (`/invoices/scan`)
- Contracts list and detail (`/contracts`, `/contracts/:id`)
- Persons list and detail (`/persons`, `/persons/:id`)
- Insured list and detail (`/insured`, `/insured/:id`)
- Settings (`/settings`)
- Keyboard: the skip-link is the first `Tab` stop and moves focus to `#main-content`

`frontend/e2e/responsive.spec.ts` checks 360×800 and 390×844 viewports (common
small-Android widths) for page-level horizontal overflow and that the mobile
bottom nav (including its "Mehr" overflow sheet) stays reachable, on the two
table-heavy pages (`/invoices`, `/invoices/:id`).

Both specs run in CI for free: `.github/workflows/ci.yml`'s existing `e2e` job
runs `pnpm test:e2e`, and Playwright auto-discovers every spec under
`frontend/e2e/` — no new workflow was needed.

## Violations found and fixed

The axe run and a full-page Lighthouse pass surfaced real, fixed issues (not
hypothetical ones):

| Issue | Where | Fix |
|---|---|---|
| No skip-link / no way to bypass repeated nav via keyboard | `AppShell.svelte` | Added a skip-link (`sr-only focus:not-sr-only`) targeting a new `#main-content` (`tabindex="-1"`) on `<main>` |
| Icon-only buttons with no accessible name (only a `title` + glyph, or nothing at all) | `contracts/[id]/+page.svelte` — edit/remove insured person, remove BRE-level/tier/limit/staffel-entry, remove Leistungsbereich | Added `aria-label` to each |
| Form inputs with only a `title` attribute, no accessible label | `contracts/[id]/+page.svelte` — BRE-level "Anzahl Monatsbeiträge" / "Anteil am Monatsbeitrag" / "Fixer Rückerstattungsbetrag" inputs | Added matching `aria-label` |
| **Active nav-item contrast 4.3:1 (needs 4.5:1)** — `text-primary` on `bg-primary/10` for the current page's nav link / the "Mehr" trigger when an overflow route is active | `Nav.svelte`, `BottomNav.svelte` | Reduced the active-state tint to `bg-primary/5`, restoring ≥4.5:1 |
| **Flagged-position warning text contrast 4.36:1** — `text-warning` on the row's `bg-warning/10` tint | `InvoiceForm.svelte`, `invoices/[id]/+page.svelte` (also unified from ad-hoc `amber-*`/`yellow-*` Tailwind classes to the shared `--warning` token for consistency) | Reduced the tint to `bg-warning/5` |
| **`svelte-sonner`'s built-in `richColors` light-theme text tokens fail AA** — as low as 3.1:1 for the warning toast, 4.25–4.36:1 for success/info/error | `app.css` (only `--success` and `--warning` were actually reachable via current `toast.success`/`toast.warning` calls; `--info`/`--error` fixed proactively since they share the same vendor defaults) | High-specificity override (`:root [data-sonner-toaster][data-sonner-theme='light']`) darkening all four `*-text` tokens to ≥5:1 against their paired backgrounds |
| One `toFixed(2)` + manual `€` suffix bypassing the shared de-DE currency formatter | `InvoiceForm.svelte` (fee-schedule info dialog base amount) | Switched to the already-imported `formatEur()` |

Currency/date formatting was otherwise already centralized
(`@selbstbehalt/shared`'s `formatEur`/`formatDate`) and consistently used — no
broader i18n cleanup was needed. The remaining `.toFixed(2)` calls in
`invoices/[id]/+page.svelte` format the GOÄ *Steigerungsfaktor* (a multiplier,
not currency) and are correctly left alone.

Also added: a shared `EmptyState` component (`frontend/src/lib/components/EmptyState.svelte`,
mirroring the existing `LoadingState`/`ErrorState` pattern) replacing ad-hoc
"no data" markup on the invoices/contracts/persons/insured list and detail
pages, for one consistent empty-state pattern across the app.

## Lighthouse accessibility score

**Score: 100 / 100** (Lighthouse 13.4.0), measured against a production build
on `/`, `/invoices`, `/contracts`, and `/settings`.

Reproduce locally:

```bash
pnpm --filter @selbstbehalt/frontend build
pnpm --filter @selbstbehalt/frontend preview --port 4173 &
CHROME_PATH=<path-to-chrome> npx lighthouse http://localhost:4173/ \
  --only-categories=accessibility --chrome-flags="--headless"
```

## Known, accepted deviations

- A handful of dense-table icon buttons and filter controls (`w-8 h-8` /
  `h-9`, e.g. the contracts-detail edit/remove buttons and the invoices-list
  status filter) sit below the 44×44px touch-target recommendation. They pass
  axe (touch-target size isn't a WCAG 2.1 AA success criterion) and the
  responsive viewport checks found no layout breakage from them; left as-is
  to avoid disrupting the dense table/form layouts for a "nice-to-have"
  ergonomics improvement rather than a compliance requirement.
- Automated coverage targets the 12 primary routes/flows enumerated above.
  The remaining routes (e.g. `/persons/new`, `/contracts/new`'s deeper form
  states) share the same primitives (shadcn/ui, `LoadingState`/`ErrorState`/`EmptyState`)
  and are lower risk, but weren't individually scanned.

## Web Push — deferred

Web-Push-Benachrichtigungen für Erstattungen (issue #29's optional item) are
**not implemented** in this pass. Both blocking dependencies (#27 service
worker, #12 refund API) are done, but a real implementation is an
independently-sized feature — VAPID key management, a backend subscription
endpoint, a service-worker push handler, and opt-in UX — and issue #29's
acceptance criteria are written disjunctively ("funktioniert *oder* ist
sauber als optional gekennzeichnet"), so deferring it to a dedicated
follow-up issue satisfies the criterion without scope creep here.
