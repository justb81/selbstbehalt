<!-- SPDX-License-Identifier: Apache-2.0 -->

# GOÄ-Wächter — GitHub Pages Deployment

The standalone [GOÄ-Wächter](../apps/goae-waechter) demo PWA (epic #166) is
published to **GitHub Pages** via GitHub Actions. It is a fully static,
backend-free build, so nothing but the compiled `apps/goae-waechter/build/`
directory is served — no server, no database, no CDN (the on-device OCR models
and ONNX-Runtime WASM are baked into the bundle and served same-origin; see
CLAUDE.md §1.3/§8).

## How it deploys

The workflow [`.github/workflows/deploy-goae-waechter.yml`](../.github/workflows/deploy-goae-waechter.yml)
is a **reusable workflow** ([`workflow_call`](https://docs.github.com/actions/using-workflows/reusing-workflows)):

1. runs when a release is cut — [`release-please.yml`](../.github/workflows/release-please.yml)
   calls it right after it publishes a `vX.Y.Z` release (so the demo is
   republished on every release, never on every ordinary `main` push) — plus
   manual **Run workflow** (`workflow_dispatch`);
2. installs dependencies and fetches the PP-OCRv5 models with `pnpm ocr:models`
   (they are **not** committed to git — see
   [`static/models/ocr/README.md`](../apps/goae-waechter/static/models/ocr/README.md));
3. builds `pnpm --filter @selbstbehalt/goae-waechter... build` (which also runs
   `copy-ort-wasm` for the ONNX-Runtime WASM);
4. publishes with `actions/upload-pages-artifact` + `actions/deploy-pages`
   (**artifact-based** — there is no `gh-pages` branch, so the repo does not grow
   by the ~50–100 MB of OCR model binaries on every deploy).

### Why release-please calls it (and not a `release:` trigger)

The `github-pages` environment enforces a **deployment branch protection rule**
that only allows the repository's default branch (`main`) to deploy. A workflow
triggered by the `release: published` event runs in the **tag** ref context
(`refs/tags/vX.Y.Z`), so the deploy was rejected with:

> Tag "vX.Y.Z" is not allowed to deploy to github-pages due to environment
> protection rules.

Calling this workflow from `release-please.yml` — which runs on `push` to
`main` — makes the deploy run in the default-branch context, which the rule
accepts, so no manual environment-settings change is needed. (`release-please`
tags the merge commit and then, in the same run, calls this workflow gated on
its `release_created` output, building `main`'s HEAD — the just-tagged commit.)

### Base path (why it is not hardcoded)

A project repo is served under a subpath — `https://<owner>.github.io/<repo>/`,
i.e. `https://justb81.github.io/selbstbehalt/`. `actions/configure-pages`
reports that path as `steps.pages.outputs.base_path`, which the build passes as
`BASE_PATH`. It flows to:

- `svelte.config.js` → `kit.paths.base` (routes + `_app` assets),
- `vite.config.ts` → the web-app-manifest `start_url`/`scope`/`icons`,
- the service worker → shell + `models/` paths are derived from its own scope,
- the shared OCR pipeline → `resolveOcrAssets(base)` prefixes the model + WASM
  URLs (`apps/goae-waechter/src/routes/+layout.svelte`).

Once a custom domain is configured (below), `base_path` becomes `/`, so the next
build automatically serves from the root — **no workflow or code change needed**.

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
