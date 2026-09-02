<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GOÄ-Wächter — GitHub Pages Deployment

The standalone [GOÄ-Wächter](../apps/goae-waechter) demo PWA (epic #166) is
published to **GitHub Pages** via GitHub Actions. It is a fully static,
backend-free build, so nothing but the compiled `apps/goae-waechter/build/`
directory is served — no server, no database, no CDN (the on-device OCR models
and ONNX-Runtime WASM are baked into the bundle and served same-origin; see
[`docs/architecture.md`](architecture.md) §2.2/§8.1).

## How it deploys

The workflow [`.github/workflows/deploy-goae-waechter.yml`](../.github/workflows/deploy-goae-waechter.yml)
is a **reusable workflow** ([`workflow_call`](https://docs.github.com/actions/using-workflows/reusing-workflows)):

1. runs when a release is cut — [`release-please.yml`](../.github/workflows/release-please.yml)
   calls it right after it publishes a `vX.Y.Z` release (so the demo is
   republished on every release, never on every ordinary `main` push) — plus
   manual **Run workflow** (`workflow_dispatch`);
2. installs dependencies and fetches the PP-OCRv6 models with `pnpm ocr:models`
   (they are **not** committed to git — see
   [`static/models/ocr/README.md`](../apps/goae-waechter/static/models/ocr/README.md));
3. builds `pnpm --filter @selbstbehalt/goae-waechter... build` (which also runs
   `copy-ort-wasm` for the ONNX-Runtime WASM);
4. publishes with `actions/upload-pages-artifact` + `actions/deploy-pages`
   (**artifact-based** — there is no `gh-pages` branch, so the repo does not grow
   by the ~50–100 MB of OCR model binaries on every deploy).

### Why it is built this way

The three decisions behind this setup — calling the workflow from
`release-please.yml` instead of a `release: published` trigger, the
artifact-based deploy without a `gh-pages` branch, and the base path taken from
`configure-pages` at build time instead of being hardcoded — are recorded with
their alternatives in
[ADR-0018](adr/0018-demo-deploy-aus-release-please-mit-build-zeit-basispfad.md).
In short: a tag-context run is rejected by the `github-pages` environment's
branch rule, a branch deploy would grow the repo by the model binaries on every
release, and `BASE_PATH` flows into `kit.paths.base`, the manifest, the service
worker and `resolveOcrAssets(base)` so a custom domain (below) needs no code
change.

## Enabling Pages

The `configure-pages` step runs with `enablement: true`, so the **first**
workflow run turns GitHub Pages on (Source = "GitHub Actions") itself using the
workflow token — no manual repository setting is normally needed. After it
completes, the app is live at `https://justb81.github.io/selbstbehalt/`.

If an organisation policy forbids the token from enabling Pages (the
`configure-pages` step then fails), enable it once by hand under **Settings →
Pages → Source = "GitHub Actions"** and re-run the workflow.

## Custom domain (when a domain is decided)

The domain is a placeholder for now; the app stays reachable at the
`github.io` URL until one is set. When a domain is chosen, follow the
[GitHub docs](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site):

1. **Settings → Pages → Custom domain**: enter the domain.
2. Configure DNS with your registrar:
   - **Subdomain** (e.g. `goae-waechter.example.com`): a `CNAME` record pointing
     to `justb81.github.io`.
   - **Apex domain** (e.g. `example.com`): the four GitHub Pages `A` records
     (and optionally the `AAAA` records) listed in the GitHub docs.
   - A `CNAME` file in the build output is **not** required for an
     Actions-based deploy (that is only for the classic branch deploy) — the
     domain is managed entirely through the Pages settings.
3. After DNS propagates, enable **"Enforce HTTPS"** in the Pages settings.
4. Re-run the deploy (push or **Run workflow**). Because the site now serves
   from the root, `base_path` is `/`, and the manifest `start_url`/`scope` plus
   the OCR asset URLs rebuild against the root automatically — no manual manifest
   edit is needed.
