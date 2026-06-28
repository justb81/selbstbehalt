# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# Frontend image for selbstbehalt (SvelteKit PWA, adapter-static). Multi-stage:
# a build stage produces the static bundle, then a slim nginx stage serves it on
# port 3000 with an SPA fallback. See docs/design.md §7.3.
#
# The build context is the repository ROOT (not ./frontend) because the frontend
# depends on the @selbstbehalt/shared workspace package and the root
# pnpm-lock.yaml. docker-compose.yml sets `context: .` accordingly.
#
# PUBLIC_API_URL is the backend base URL the browser talks to. It defaults to
# empty, meaning "same origin": the nginx stage below proxies /api to the backend
# (see frontend/nginx.conf), so the browser only ever talks to this one origin
# and the reverse-proxy Basic Auth covers the API too. Set it only to point the
# browser at a *separate* backend origin (e.g. https://api.example.com). On a
# static adapter, SvelteKit's $env/dynamic/public is captured at build time, so
# it is a build arg here — not a runtime container env; changing it needs a
# rebuild. Users can also override it at runtime via the in-app settings.

# ---- Stage 1: build the static PWA bundle ----
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency-install layer caches across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# Install only the frontend's subtree (frontend + the shared package it needs).
# --ignore-scripts: only the manifests have been copied so far, so the
# @selbstbehalt/shared `prepare` script (`tsc -p tsconfig.build.json`) would
# fail — its sources don't exist in this layer yet. The frontend pulls in no
# dependencies that need a postinstall build, and shared is compiled explicitly
# below once its sources are in place.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@selbstbehalt/frontend..." --ignore-scripts

# Sources for the frontend and its shared dependency. `scripts/` holds the OCR
# asset helpers (ocr:models, copy-ort-wasm) the frontend build invokes.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend
COPY scripts scripts

RUN pnpm --filter @selbstbehalt/shared build

# On-device OCR assets, baked into the served bundle so nothing is fetched from a
# CDN at runtime (CLAUDE.md privacy constraint; docs/design.md §1.3/§8):
#   - PP-OCRv5 models via `pnpm ocr:models` (needs curl + network at build time;
#     see frontend/static/models/ocr/README.md),
#   - the ONNX Runtime WASM, copied from node_modules by the frontend build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm ocr:models

ARG PUBLIC_API_URL=
ENV PUBLIC_API_URL=$PUBLIC_API_URL
RUN pnpm --filter @selbstbehalt/frontend build

# ---- Stage 2: runtime (nginx serving the static SPA, non-root) ----
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /repo/frontend/build /usr/share/nginx/html
# Run as the unprivileged `nginx` user (uid 101) shipped with the base image.
USER nginx
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
