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
# PUBLIC_API_URL is the backend base URL the browser talks to. On a static
# adapter, SvelteKit's $env/dynamic/public is captured at build time, so it is a
# build arg here — not a runtime container env. It must point at where the
# *browser* reaches the backend (e.g. http://nas.local:8080), which is usually
# different from the in-compose-network address. Users can also override it at
# runtime via the in-app settings (persisted to localStorage).

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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@selbstbehalt/frontend..."

# Sources for the frontend and its shared dependency.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend

RUN pnpm --filter @selbstbehalt/shared build

ARG PUBLIC_API_URL=http://localhost:8080
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
