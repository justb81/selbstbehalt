<!-- SPDX-License-Identifier: Apache-2.0 -->

# GOÄ-Wächter — GitHub Pages Deployment

The standalone [GOÄ-Wächter](../apps/goae-waechter) demo PWA (epic #166) is
published to **GitHub Pages** via GitHub Actions. It is a fully static,
backend-free build, so nothing but the compiled `apps/goae-waechter/build/`
directory is served — no server, no database, no CDN (the on-device OCR models
and ONNX-Runtime WASM are baked into the bundle and served same-origin; see
CLAUDE.md §1.3/§8).

## How it deploys

The workflow [`.github/workflows/deploy-goae-waechter.yml`](../.github/workflows/deploy-goae-waechter.yml):

1. runs on every push to the default branch that touches the demo app, the
   shared `packages/medic-invoice-check`/`packages/shared`, the build scripts,
   or the lockfile — plus manual **Run workflow** (`workflow_dispatch`);
2. installs dependencies and fetches the PP-OCRv5 models with `pnpm ocr:models`
   (they are **not** committed to git — see
   [`static/models/ocr/README.md`](../apps/goae-waechter/static/models/ocr/README.md));
3. builds `pnpm --filter @selbstbehalt/goae-waechter... build` (which also runs
   `copy-ort-wasm` for the ONNX-Runtime WASM);
4. publishes with `actions/upload-pages-artifact` + `actions/deploy-pages`
   (**artifact-based** — there is no `gh-pages` branch, so the repo does not grow
   by the ~50–100 MB of OCR model binaries on every deploy).

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

## One-time repository setting

In **Settings → Pages**, set **Source = "GitHub Actions"**. This is a repository
setting that cannot be scripted from the workflow; it must be enabled once by a
maintainer before the first deploy. After that, the app is live at
`https://justb81.github.io/selbstbehalt/`.

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
