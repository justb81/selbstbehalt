<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contributing to selbstbehalt

Thanks for your interest in improving **selbstbehalt**! This is a privacy-first,
self-hostable manager for German private health insurance (PKV). Contributions —
code, data, docs, or bug reports — are welcome.

> **All changes are reviewed by the maintainer.** Every pull request, regardless
> of size or area (code, data, docs), requires a review and approval from
> [@justb81](https://github.com/justb81) before it can be merged. This is
> enforced via [`CODEOWNERS`](CODEOWNERS) and branch protection. Please open an
> issue to discuss anything substantial before investing time in a PR.

## Ways to contribute

- **Report a bug** — open a [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml).
- **Report a fee-schedule data error** — found a wrong amount, description, or
  category in the GOÄ/GOZ/GOT tables? Open a
  [Data error report](.github/ISSUE_TEMPLATE/data_error.yml). See
  [Fee-schedule data](#fee-schedule-data-goägozgot) for why you should report
  rather than hand-edit.
- **Request a feature** — open a [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml).
- **Open a pull request** — see [Development setup](#development-setup) and
  [Submitting a pull request](#submitting-a-pull-request).

## Development setup

Prerequisites: **Node.js 24 LTS** (see [`.nvmrc`](.nvmrc)) and **pnpm 10+**.
With [Corepack](https://nodejs.org/api/corepack.html) enabled
(`corepack enable`), the pinned pnpm version is used automatically.

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # run frontend + backend dev servers (parallel)
pnpm build          # build every workspace package
pnpm lint           # lint every workspace package
pnpm test           # test every workspace package
pnpm typecheck      # type-check every workspace package
```

Copy [`.env.example`](.env.example) to `.env` and adjust it for your setup.

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo with six
packages — [`apps/frontend/`](apps/frontend/) (SvelteKit PWA),
[`apps/backend/`](apps/backend/) (Hono REST API + SQLite),
[`apps/goae-waechter/`](apps/goae-waechter/) (the standalone GOÄ-Wächter demo),
[`packages/medic-invoice-check/`](packages/medic-invoice-check/) (on-device OCR +
GOÄ/GOZ/GOT check engine), [`packages/ui/`](packages/ui/) (the shared
shadcn-svelte primitives) and [`packages/shared/`](packages/shared/) (Zod schemas,
types, domain helpers). See [`README.md`](README.md) and
[`docs/architecture.md`](docs/architecture.md) for the architecture.

## Where documentation goes

[`docs/architecture.md`](docs/architecture.md) is the single source of truth for
architecture, data model and domain logic. It follows the twelve
[arc42](https://arc42.org/) chapters, and that structure is the point: **put new
content in the chapter it belongs to** — a runtime flow in chapter 6, a
cross-cutting concept in chapter 8, a decision with its reasoning in chapter 9 —
rather than appending it wherever it fits. A term the domain relies on goes in the
glossary (chapter 12).

Two rules keep it from drifting apart again:

- **One content, one place.** If something is already documented, link to it
  instead of restating it. Duplicated prose diverges.
- **References use the chapter number**, e.g. `docs/architecture.md §8.5`.
  `pnpm docs:check` verifies that every such reference resolves, and runs in CI on
  every change (including docs-only ones).
- **Architecture decisions get an ADR.** Chapter 9 of the architecture doc is the
  one-line log; the reasoning — context, alternatives considered, consequences —
  lives as an Architecture Decision Record under [`docs/adr/`](docs/adr/README.md).
  Copy [`0000-template.md`](docs/adr/0000-template.md), take the next number, add
  the row in chapter 9 and the index entry. A decision is never rewritten: a
  changed one is superseded by a new ADR.
- **Diagrams are Mermaid**, inline in the document they explain — GitHub renders
  them, they diff, and they cannot drift away as separate image files.

The deeper operational guides stay separate and are linked from the chapter they
belong to — [`self-hosting.md`](docs/self-hosting.md),
[`hardening.md`](docs/hardening.md), [`data-format.md`](docs/data-format.md),
[`privacy-threat-model.md`](docs/privacy-threat-model.md). Note that
`data-format.md` and `privacy-threat-model.md` have their **own** §-numbering;
always name the file when citing them.

## Branch & commit conventions

- **Branch off `main`.** Use a descriptive branch name, e.g.
  `feat/contracts-api`, `fix/parser-factor-limit`, `docs/contributing`.
- **Conventional Commits** for commit messages and PR titles:
  `type(scope): summary`, e.g. `feat(backend): add contracts CRUD`.
  Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.
  This is enforced by commitlint (`commit-msg` hook) and drives the automated
  changelog/version bump — see [`docs/release.md`](docs/release.md).
- Keep commits focused and the history readable; rebase rather than merge `main`
  into your branch when it drifts.

## Quality bar

Before opening a PR, make sure the following pass locally — CI runs the same
checks and a PR will not be merged while they are red:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- **Tests** — add or update tests for any behavior change. The two
  domain-critical algorithms (the GOÄ parser and the Günstigerprüfung) must
  stay well-covered.
- **Docs** — update affected docs in the same change. Don't leave stale
  references behind (see the change policy in [`CLAUDE.md`](CLAUDE.md)).
- **License headers** — source files name both their copyright holder and their
  license, as two adjacent SPDX lines at the top (use the comment syntax of the
  respective language):

  ```ts
  // SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
  // SPDX-License-Identifier: Apache-2.0
  ```

  `pnpm headers:check` verifies this (and `--fix` inserts what is missing); CI
  runs it on every change. Vendored, generated and comment-less files are
  excluded with a documented reason in
  [`scripts/check-spdx-headers.mjs`](scripts/check-spdx-headers.mjs) — notably
  the shadcn-svelte components under `src/lib/components/ui/` (in `packages/ui/`
  and `apps/frontend/`), which stay under their own upstream license. Contributing does not require adding your own
  copyright line: `and contributors` covers it.

## Privacy constraints (non-negotiable)

This project follows Privacy by Design (see §2.2 and §8.1 of
[`docs/architecture.md`](docs/architecture.md)). PRs that violate these will not be merged:

- **Invoice images never leave the client.** OCR runs in the browser; only
  structured JSON metadata (no images) is sent to the backend.
- **No server-side AI/LLM.** All inference is client-side.
- **No third-party runtime dependencies** — no analytics, no external CDN
  loading. Health data falls under Art. 9 DSGVO; treat invoice content and
  diagnoses as maximally sensitive.

## Fee-schedule data (GOÄ/GOZ/GOT)

The GOÄ/GOZ/GOT lookup tables under `packages/medic-invoice-check/src/lib/data/` are **not
hand-maintained**. They are generated reproducibly from the official source XML
under [`data/input/`](data/input/) by the maintainer, and the tables are
maintained **exclusively by the maintainer** ([@justb81](https://github.com/justb81)).

So please:

- **Do not hand-edit** `goae.json` / `goz.json` / `got.json` in a PR — such
  changes will be regenerated and overwritten.
- If you spot an error, **open a
  [Data error report](.github/ISSUE_TEMPLATE/data_error.yml)** instead. Keep it
  simple: the affected code, the expected vs. actual value, and your source.
- Corrections to the _extraction/generation_ tooling itself are of course
  welcome as PRs (see issue #15).

## Submitting a pull request

1. Fork the repo (or branch, if you have access) and push your branch.
2. Open a PR against `main`, filling in the
   [pull request template](.github/pull_request_template.md).
3. Make sure CI is green.
4. A maintainer review from [@justb81](https://github.com/justb81) is
   **required** before merge — please be patient and responsive to feedback.

## Code of Conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report security vulnerabilities privately — see
[`SECURITY.md`](SECURITY.md). Do **not** open a public issue for them.
