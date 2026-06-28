# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# Backend image for selbstbehalt (Hono + SQLite). Multi-stage: a build stage
# compiles the TypeScript and the better-sqlite3 native binding, then `pnpm
# deploy` produces a self-contained production bundle (prod deps + the built
# @selbstbehalt/shared workspace package) which a slim runtime stage serves. The
# server process itself runs unprivileged as `node`; the entrypoint starts as
# root only to repair bind-mount ownership, then drops privileges (see
# docker-entrypoint.sh). See docs/design.md §7.3.
#
# The build context is the repository ROOT (not ./backend) because the backend
# depends on the @selbstbehalt/shared workspace package and the root
# pnpm-lock.yaml — a per-app context could not resolve either. docker-compose.yml
# sets `context: .` accordingly.

# ---- Stage 1: build (TypeScript → JS, native modules compiled) ----
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# better-sqlite3 compiles a native binding from source — needs a toolchain.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Manifests first so the dependency-install layer caches across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# Install only the backend's subtree (backend + the shared package it needs).
# --ignore-scripts: only the manifests have been copied so far, so the
# @selbstbehalt/shared `prepare` script (`tsc -p tsconfig.build.json`) would
# fail — its sources don't exist in this layer yet (shared is compiled
# explicitly below). Skipping scripts also skips better-sqlite3's native build,
# so rebuild just that one afterwards to compile its binding into the store.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@selbstbehalt/backend..." --ignore-scripts \
  && pnpm rebuild better-sqlite3

# Sources for the backend and its shared dependency.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend

RUN pnpm --filter @selbstbehalt/shared build \
  && pnpm --filter @selbstbehalt/backend build

# Self-contained production bundle in /app (dist + prod node_modules, with the
# built shared package copied in). inject-workspace-packages lets `deploy` copy
# from the local store instead of re-resolving from the registry.
RUN pnpm --filter @selbstbehalt/backend \
  --config.inject-workspace-packages=true \
  deploy --prod /app

# ---- Stage 2: runtime (slim; entrypoint drops to the non-root `node` user) ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Defaults mirror docs/design.md §7.3; the DB path points at the mounted volume.
ENV DATABASE_PATH=/app/db/pkv.sqlite
ENV PORT=8080
WORKDIR /app

# gosu lets the entrypoint drop from root to the unprivileged `node` user after
# fixing bind-mount ownership (see docker-entrypoint.sh).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app ./
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Volume mount points for the SQLite database and optional invoice files. When
# unmounted (or backed by a named volume, which inherits this ownership) they
# stay writable by `node`; a root-owned host bind mount is re-owned at startup
# by the entrypoint.
RUN mkdir -p /app/db /app/files && chown -R node:node /app/db /app/files
EXPOSE 8080

# Liveness/readiness probe against the unauthenticated health route (§7.2).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
