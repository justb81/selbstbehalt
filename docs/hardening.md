# Hardening & Deployment Security

Practical guide to the deployment-security pieces from
[`docs/design.md`](design.md) §7.2 and §8 (issue #31): the CSP/security
headers the app ships with, how to put it behind an HTTPS reverse proxy with
HTTP Basic Auth, and when (and how) to use the optional `X-API-Key`. See
[`SECURITY.md`](../SECURITY.md) for the condensed pre-deployment checklist and
how to report a vulnerability.

## Content Security Policy & security headers

Both services set their own security headers — no reverse-proxy configuration
is required for this part; it's defense in depth on top of whatever the proxy
adds.

- **Frontend** ([`apps/frontend/security-headers.conf`](../apps/frontend/security-headers.conf),
  `include`d by every `location` in [`nginx.conf`](../apps/frontend/nginx.conf)):
  a strict `Content-Security-Policy` (no third-party scripts/styles/connects —
  everything is `'self'`, matching the "no CDN, no third-party dependencies"
  rule in `CLAUDE.md`/§8.2), plus `Strict-Transport-Security`,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy`. The file documents, directive by directive, exactly
  which app feature needs each relaxation from a maximally strict policy
  (`wasm-unsafe-eval` for the on-device OCR's WebAssembly runtime, a
  build-generated script hash for SvelteKit's own inline init script,
  `unsafe-inline` for a couple of shadcn-svelte components' dynamic inline
  `style` attributes, `camera=(self)` for the invoice scanner) — read it there
  rather than here, so the rationale can never drift out of sync with the
  policy itself.
- **Backend** ([`apps/backend/src/app.ts`](../apps/backend/src/app.ts), via
  [`hono/secure-headers`](https://hono.dev/docs/middleware/builtin/secure-headers)):
  a locked-down `default-src 'none'` CSP plus the standard header set, tuned
  so `Cross-Origin-Resource-Policy` doesn't accidentally block the documented
  separate-origin `X-API-Key` deployment below.

**How this was verified** (issue #31's "App lädt unter strikter CSP ohne
externe Requests" acceptance criterion): the built frontend was served by a
real nginx binary running the shipped config, confirming the headers render
on every route (including error responses) and that a headless Chromium
instance loads the dashboard plus five other routes directly and opens the
OCR scanner (which instantiates the same-origin module worker) without a
single `securitypolicyviolation` event.
The one fragile-looking part — the CSP hash that allowlists SvelteKit's inline
init script — isn't a value hardcoded at authoring time: that script embeds
Vite's content-hashed chunk filenames, which are *not* stable across builds or
even machines (e.g. they can shift with the absolute build path), so a
hardcoded hash would eventually go stale and silently break the app under this
CSP. [`scripts/generate-frontend-security-headers.mjs`](../scripts/generate-frontend-security-headers.mjs)
computes it fresh from the actual built `index.html` as part of the frontend
Docker build, and [`apps/frontend/e2e/csp.spec.ts`](../apps/frontend/e2e/csp.spec.ts)
exercises that same script in CI. Real-browser verification of the WebGPU
execution path specifically remains tracked under issue #27, same as before
this change — that's an OCR-correctness concern rather than a CSP one.

## Reverse proxy: HTTPS + HTTP Basic Auth

HTTPS is mandatory (§7.2) — even for a LAN-only deployment, use a self-signed
certificate rather than plain HTTP, since HTTP Basic Auth credentials are only
as safe as the transport they travel over. Two ready-to-use examples, either
one sits in front of the unmodified [`docker-compose.yml`](../docker-compose.yml)
as an override:

- [`deploy/reverse-proxy/traefik/`](../deploy/reverse-proxy/traefik/) — Traefik
  with automatic Let's Encrypt (or a static self-signed cert) and a Basic Auth
  middleware, configured via Docker labels.
- [`deploy/reverse-proxy/nginx/`](../deploy/reverse-proxy/nginx/) — a
  standalone nginx `server` block doing the same with `certbot` for Let's
  Encrypt.

Both examples route only the **frontend** container (the default
single-origin setup from §7.2): its own nginx proxies `/api` to the backend
over the Compose network, so one Basic Auth prompt covers the whole app,
including the API, and there is no CORS to configure. Each example's README
covers generating the `htpasswd` file and both TLS options in detail.

## External access: `X-API-Key` (VPN / Tailscale)

The default single-origin deployment above needs no separate API
authentication — the reverse proxy's Basic Auth already covers `/api/*`
because the browser only ever talks to one origin. `X-API-Key`
([`apps/backend/src/middleware/auth.ts`](../apps/backend/src/middleware/auth.ts))
exists for the one case that setup doesn't cover: reaching the **backend**
directly from the browser on a **different origin** than the frontend (e.g.
publishing the backend under its own hostname/route over Tailscale, or
pointing a dev frontend at a remote backend). HTTP Basic Auth credentials are
not sent by the browser across origins, so without it a separate backend
origin would otherwise be unauthenticated.

If you just want to reach your existing single-origin deployment from outside
your home network — the common Tailscale/VPN case — you don't need any of
this: join the host to your tailnet and browse to it via its Tailscale
IP/MagicDNS name; the reverse proxy's Basic Auth still applies unchanged.
`X-API-Key` is specifically for a **separate backend origin**:

1. Set **`PUBLIC_API_URL`** to the backend's public origin — the browser must
   be able to resolve and reach it directly, so this can never be the
   in-Compose service name `backend`. It's baked into the frontend bundle at
   build time (a build arg), so rebuild the frontend image after changing it,
   or override it at runtime in the app's settings.
2. Set **`PKV_API_KEY`** (backend `API_KEY` env var) to a long random secret,
   e.g. `openssl rand -hex 32`. Every `/api/*` route requires the matching
   `X-API-Key` header once this is set, except the unauthenticated
   `/api/health` liveness probe.
3. Set **`CORS_ORIGINS`** to the frontend's exact origin — not `*`, which
   would let any website's script call your API with a stolen or brute-forced
   key.
4. Give the backend's own route HTTPS too (another Traefik label or nginx
   `server` block) — `X-API-Key` is a bearer secret and must never travel over
   plain HTTP.

See [`.env.example`](../.env.example) for where each of these variables is
wired into `docker-compose.yml`.
