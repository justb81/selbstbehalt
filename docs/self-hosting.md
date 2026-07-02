# Self-hosting guide

A complete walkthrough for running **selbstbehalt** on your own hardware — a
Proxmox LXC, a NAS (Synology/Unraid/TrueNAS with Docker support), or any Linux
box with Docker. It complements the shorter [README](../README.md#running-with-docker-self-hosting)
quickstart with configuration reference, remote-access options, backup, and
troubleshooting. See [`docs/design.md`](design.md) §2.3/§7/§7.3 for the
underlying design and [`docs/hardening.md`](hardening.md) for the security
deep-dive (CSP, reverse proxy, `X-API-Key`).

## Contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Configuration reference](#configuration-reference)
- [Deployment targets](#deployment-targets)
- [Reverse proxy & HTTPS](#reverse-proxy--https)
- [Remote access: VPN / Tailscale](#remote-access-vpn--tailscale)
- [Backup & restore](#backup--restore)
- [Updating](#updating)
- [Troubleshooting & FAQ](#troubleshooting--faq)

## Prerequisites

- **Docker Engine** with the **Compose v2** plugin (`docker compose version`).
  Any recent Linux distribution works; Proxmox VE's Debian-based LXC
  templates and NAS Docker add-ons (Synology Container Manager, Unraid's
  Docker tab, TrueNAS apps) are all fine.
- **~1 vCore / 256 MB RAM / a few GB disk** — the backend alone stays around
  128–256 MB RAM (§2.3); the frontend is a static nginx serving a PWA.
- A way to reach the host: same LAN, or a VPN (see
  [Remote access](#remote-access-vpn--tailscale)) if you want it reachable
  away from home. **No public port-forwarding is required or recommended.**
- **No GPU needed.** OCR runs in the visiting *browser* (WebGPU with a WASM
  fallback), never on the server.

## Quickstart

```bash
git clone https://github.com/justb81/selbstbehalt.git
cd selbstbehalt
cp .env.example .env      # edit as described below
docker compose up -d --build
```

This builds both images locally and starts them. To use pre-built multi-arch
(amd64/arm64) images from GHCR instead — no local build toolchain needed —
use [`docker-compose.release.yml`](../docker-compose.release.yml):

```bash
cp .env.example .env
SELBSTBEHALT_VERSION=1.2.3 docker compose -f docker-compose.release.yml up -d
```

Leave `SELBSTBEHALT_VERSION` unset to track `latest`. See
[`docs/release.md`](release.md) for how tags turn into GHCR images.

Both containers publish **no host ports** by default — they sit behind a
reverse proxy on the Docker network (`expose`d internally: frontend `3000`,
backend `8080`). Until you've set one up (next section), you can reach the
frontend directly by adding a port mapping, e.g. an override file with:

```yaml
services:
  frontend:
    ports:
      - '127.0.0.1:8080:3000' # bind to localhost only while testing
```

Once containers are healthy (`docker compose ps` shows both `healthy`), open
the app and its Dashboard should look like this:

![Dashboard](../assets/screenshots/dashboard.png)

## Configuration reference

All configuration lives in `.env` (copied from [`.env.example`](../.env.example)
and never committed — it's gitignored). Variables map into
[`docker-compose.yml`](../docker-compose.yml):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `data/db/pkv.sqlite` (container: `/app/db/pkv.sqlite`) | Path to the SQLite file, inside the bind-mounted `./data/db` volume. |
| `PORT` | `8080` | Backend HTTP port (inside the container; not published by default). |
| `CORS_ORIGINS` | `*` | Allowed CORS origins. Irrelevant for the default single-origin setup; set to the frontend's exact origin if you use a separate backend origin (see `X-API-Key` below). |
| `PKV_API_KEY` | _(empty)_ | Wires into the backend as `API_KEY`. Enables `X-API-Key` auth for a **separate backend origin** (VPN/Tailscale case). Leave empty when the reverse proxy's Basic Auth already covers everything (default). |
| `PUBLIC_API_URL` | _(empty)_ | Base URL the **browser** uses to reach the backend. Leave empty for the recommended single-origin setup (frontend's nginx proxies `/api`). Baked into the frontend bundle at *build time* — changing it requires `docker compose build frontend`. |

Two directories are bind-mounted so data survives restarts, `down`/`up`, and
image rebuilds:

- `./data/db` — the SQLite database file.
- `./data/files` — optional saved invoice files (only if you opt in to
  keeping them; OCR itself never uploads images, see
  [Privacy by design](../README.md#design-principles)).

The backend container's entrypoint fixes the ownership of these
Docker-created (root-owned) directories on startup, then drops to the
unprivileged `node` user — no manual `chown` needed.

## Deployment targets

- **Proxmox VE (LXC):** use an unprivileged Debian/Ubuntu LXC with nesting
  enabled (`Options → Features → Nesting`) so Docker can run inside it, or
  run Docker directly on a Proxmox VM. Give the container the vCPU/RAM
  budget above; no GPU passthrough needed.
- **NAS (Synology, Unraid, TrueNAS SCALE, …):** any NAS with a Docker/Compose
  add-on works. Point the two bind mounts (`./data/db`, `./data/files`) at a
  persistent share, and put the app behind whatever reverse-proxy package
  your NAS ships (Synology's built-in reverse proxy, SWAG, Nginx Proxy
  Manager, …) or one of the examples below.
- **Coolify / Portainer / plain `docker compose` on any VPS or home
  server:** the same two Compose files work unmodified — Coolify and
  Portainer both consume standard `docker-compose.yml`.

## Reverse proxy & HTTPS

**HTTPS is mandatory** (§7.2), even on a LAN-only deployment — use a
self-signed certificate rather than plain HTTP, since HTTP Basic Auth
credentials are only as safe as the transport they travel over.

Two ready-to-use override examples route only the **frontend** container
(the recommended single-origin setup: its own nginx proxies `/api` to the
backend over the Compose network, so one Basic Auth prompt covers the whole
app, including the API, with no CORS to configure):

- [`deploy/reverse-proxy/traefik/`](../deploy/reverse-proxy/traefik/) —
  Traefik with automatic Let's Encrypt (or a static self-signed cert) and a
  Basic Auth middleware via Docker labels.
- [`deploy/reverse-proxy/nginx/`](../deploy/reverse-proxy/nginx/) — a
  standalone nginx `server` block with the same Basic Auth, using `certbot`
  for Let's Encrypt.

Each example's own README covers generating the `htpasswd` file and both TLS
options (public Let's Encrypt vs. self-signed for a LAN-only host) in detail.
See [`docs/hardening.md`](hardening.md) for the full rationale, the CSP/
security headers both services ship with, and the hardening checklist in
[`SECURITY.md`](../SECURITY.md#hardening-checklist).

## Remote access: VPN / Tailscale

If you just want to reach your **existing single-origin deployment** from
outside your home network, you don't need any extra backend configuration:
join the host to your [Tailscale](https://tailscale.com/) tailnet (or
WireGuard/OpenVPN of your choice) and browse to it via its Tailscale
IP/MagicDNS name. The reverse proxy's Basic Auth still applies unchanged —
this is the recommended way to use the app from a phone away from home.

`X-API-Key` auth is for the one case that doesn't cover: publishing the
**backend** under its own hostname/origin, separate from the frontend (e.g. a
remote frontend build calling a Tailscale-only backend). If you need that:

1. Set `PUBLIC_API_URL` to the backend's public origin — must be reachable
   directly by the browser (never the in-Compose service name `backend`).
   Rebuild the frontend image after changing it.
2. Set `PKV_API_KEY` (backend `API_KEY`) to a long random secret, e.g.
   `openssl rand -hex 32`. Every `/api/*` route then requires the matching
   `X-API-Key` header, except the unauthenticated `/api/health` probe.
3. Set `CORS_ORIGINS` to the frontend's exact origin — never `*` here, since
   that would let any website call your API with a stolen/brute-forced key.
4. Give the backend's own route HTTPS too — `X-API-Key` is a bearer secret
   and must never travel over plain HTTP.

See [`docs/hardening.md`](hardening.md#external-access-x-api-key-vpn--tailscale)
for the full explanation of when you actually need this.

## Backup & restore

The database is the entire application state (no server-side files beyond
the optional saved invoices). Two options:

**Volume-level (recommended, no downtime):** back up the bind-mounted
`./data/db` and `./data/files` directories directly with whatever host-level
backup tool you already use (e.g. `restic`, `borg`, your NAS's snapshot
feature, or a plain `tar`/`rsync` of the `data/` directory). SQLite's file
format is safe to copy while the app is running as long as your backup tool
performs an atomic filesystem-level snapshot or copy (most NAS snapshot
tools do; a naive `cp` while the app is under heavy write load is not
guaranteed consistent).

**Application-level export/import (Art. 20 DSGVO data portability):** the
backend exposes a consistent-snapshot download and a validated restore:

```bash
# Export: downloads the current SQLite database as an attachment
curl -u <user>:<password> https://pkv.example.com/api/export/db -o backup.sqlite

# Import: uploads a database file to replace the current one.
# The backend backs up the existing DB before overwriting and rejects
# schema-incompatible files with a clear error.
curl -u <user>:<password> -F 'file=@backup.sqlite' https://pkv.example.com/api/import/db
```

(Drop `-u <user>:<password>` if you're not behind Basic Auth, e.g. calling
the backend directly on your LAN; add `-H 'X-API-Key: ...'` instead if you've
configured that.) Both endpoints are also reachable from the app's
Settings page. Always keep at least one backup **before** importing, since
import overwrites the live database (the backend itself also snapshots the
outgoing DB first, but don't rely on that as your only copy).

## Updating

```bash
git pull
docker compose up -d --build        # local build
# — or, tracking releases —
docker compose -f docker-compose.release.yml pull
docker compose -f docker-compose.release.yml up -d
```

Both compose files declare `restart: unless-stopped`, so the stack also
survives a host reboot. The `./data/db` and `./data/files` volumes are
untouched by image rebuilds — only `docker compose down -v` would remove
them, so avoid `-v` unless you mean to wipe local data.

## Troubleshooting & FAQ

**Frontend shows "Verbindung fehlgeschlagen" / can't reach the API.**
Check `docker compose ps` — the frontend only starts once the backend
reports healthy (`depends_on: service_healthy` on `/api/health`). If the
backend is unhealthy, check `docker compose logs backend`; a common cause is
an invalid `DATABASE_PATH` or a permissions issue on the `./data/db` bind
mount (the entrypoint should fix ownership automatically — if it doesn't,
check the host directory isn't mounted read-only).

**Do I need a GPU for OCR?** No. OCR (PP-OCRv5 via `ppu-paddle-ocr` on ONNX
Runtime) runs **in the visiting browser**, not on the server — the backend
never runs any AI/ML workload (§2.3, §8). It tries WebGPU first and falls
back to WASM automatically if the browser/device doesn't support WebGPU
(e.g. older Safari, some mobile browsers, or a browser with WebGPU disabled).
Both paths run fully offline — no data or model requests leave the device at
inference time beyond the initial model download from your own server
(never a third-party CDN — see [Privacy by design](../README.md#design-principles)).

**OCR result looks wrong / misses positions.** Doctor invoices are usually
typewritten or letterhead-printed, and PP-OCRv5 handles that well.
**Handwritten** invoices or annotations are a known, documented limitation
(design doc §10: "OCR Handschrift — Limitiert") — recognition quality drops
significantly on handwriting, and there is currently no automatic fallback
beyond manual correction in the review step. Always check the parsed line
items against the original invoice image in the review screen before
saving; nothing is written to the backend until you confirm.

**Scanner won't open the camera.** The camera requires a secure context
(HTTPS, or `localhost`) — this is a browser platform requirement, not
something the app can work around. Make sure your reverse proxy actually
serves HTTPS (even self-signed) before troubleshooting further; browsers
silently deny camera access on plain HTTP for any non-localhost origin.

**CSP / console errors after adding a custom reverse-proxy header or a
browser extension.** The app ships a strict, `'self'`-only Content Security
Policy (no third-party scripts, styles, or connections — see
[`docs/hardening.md`](hardening.md#content-security-policy--security-headers)).
That's intentional and matches the "no third-party runtime dependency" rule;
if you see CSP violations in the browser console that aren't caused by a
browser extension injecting its own scripts, please
[open an issue](https://github.com/justb81/selbstbehalt/issues/new/choose)
rather than loosening the policy yourself.

**How do I move to a different host?** Copy the `./data/db` (and
`./data/files`, if used) directories to the new host, or use the
export/import endpoints above, then start the same Compose stack there.

**Where do I report a security issue?** Not as a public GitHub issue — see
[`SECURITY.md`](../SECURITY.md).
