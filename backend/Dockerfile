# syntax=docker/dockerfile:1
# SPDX-License-Identifier: Apache-2.0
#
# Backend image for selbstbehalt (Hono + SQLite). Multi-stage: a build stage
# compiles the TypeScript and the better-sqlite3 native binding, then `pnpm
# deploy` produces a self-contained production bundle (prod deps + the built
# @selbstbehalt/shared workspace package) which a slim, non-root runtime stage
# serves. See docs/design.md §7.3.
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter "@selbstbehalt/backend..."

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

# ---- Stage 2: runtime (slim, non-root) ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Defaults mirror docs/design.md §7.3; the DB path points at the mounted volume.
ENV DATABASE_PATH=/app/db/pkv.sqlite
ENV PORT=8080
WORKDIR /app

COPY --from=build /app ./

# Volume mount points for the SQLite database and optional invoice files,
# owned by the unprivileged `node` user that ships with the base image.
RUN mkdir -p /app/db /app/files && chown -R node:node /app
USER node
EXPOSE 8080

# Liveness/readiness probe against the unauthenticated health route (§7.2).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
