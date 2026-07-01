# Release process

selbstbehalt versions itself with [SemVer](https://semver.org/) and automates
the entire release from [Conventional Commits](https://www.conventionalcommits.org/)
via [release-please](https://github.com/googleapis/release-please). There is
no manual version bumping, changelog editing, or tagging.

## How a release happens

1. **Every commit on `main` follows Conventional Commits** (already enforced
   by commitlint, see [`CONTRIBUTING.md`](../CONTRIBUTING.md)). `fix:` commits
   bump the patch version, `feat:` commits bump the minor version, and a
   `BREAKING CHANGE:` footer (or `!` after the type) bumps the major version.
2. **`release-please.yml`** runs on every push to `main`. It maintains a
   standing "chore(main): release X.Y.Z" pull request that accumulates the
   changelog entries and version bump for all commits landed since the last
   release. The PR is kept up to date automatically — nothing to do until
   you're ready to ship.
3. **Merging that PR is the release.** release-please tags the merge commit
   `vX.Y.Z`, updates [`CHANGELOG.md`](../CHANGELOG.md), and publishes a GitHub
   Release with the generated notes.
4. **`release.yml`** triggers on the `vX.Y.Z` tag push. It builds multi-arch
   (`linux/amd64` + `linux/arm64`) images for both services, pushes them to
   GHCR as `ghcr.io/justb81/selbstbehalt-backend` and
   `ghcr.io/justb81/selbstbehalt-frontend` tagged `X.Y.Z`, `X.Y`, and
   `latest`, signs them keylessly with [cosign](https://github.com/sigstore/cosign)
   (GitHub OIDC), generates a CycloneDX SBOM per image, and attaches the SBOMs
   plus [`docker-compose.release.yml`](../docker-compose.release.yml) to the
   GitHub Release release-please just created.

Versioning covers the application as a whole (one tag, one changelog) rather
than frontend/backend/shared independently — they are always deployed
together. `extra-files` in
[`release-please-config.json`](../release-please-config.json) keeps every
workspace `package.json` version field in sync with the release tag.

### CI on the release PR

GitHub Actions doesn't trigger further workflow runs for a PR authored with
the default `GITHUB_TOKEN` (an anti-recursion safeguard), so `ci.yml` and
`security.yml` won't automatically run against the release-please PR unless a
`RELEASE_PLEASE_TOKEN` repository secret is configured (a fine-grained PAT or
GitHub App installation token with `contents: write` + `pull-requests: write`
on this repo). Without it, the PR still opens and updates normally — just
without status checks; push an empty commit or close/reopen the PR to trigger
them manually before merging if your branch protection requires green CI.

## Using a release

Pre-built images require no local build toolchain:

```bash
cp .env.example .env
SELBSTBEHALT_VERSION=1.2.3 docker compose -f docker-compose.release.yml up -d
```

Leave `SELBSTBEHALT_VERSION` unset to track `latest`. See
[`docker-compose.release.yml`](../docker-compose.release.yml) for the full
option/volume reference (identical to `docker-compose.yml`, just pulling
instead of building).

## Dry-running a release

To sanity-check both Dockerfiles still build correctly without cutting a real
tag, run **release.yml** manually:

- GitHub → **Actions** → **Release** → **Run workflow**, on any branch.

A manual (`workflow_dispatch`) run always builds for `linux/amd64` only and
never pushes, signs, or attaches anything — it exercises the same build steps
as a real release without touching GHCR or the release. Only an actual
`vX.Y.Z` tag push (i.e. merging the release-please PR) performs the real
multi-arch push, signing, and release-asset upload.

To preview what the *next* release-please PR would contain without waiting
for the scheduled run, push a Conventional Commit to `main` and check the
`release-please.yml` workflow run — it opens or updates the release PR
immediately.
