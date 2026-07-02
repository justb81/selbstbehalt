# Traefik reverse proxy (HTTPS + Basic Auth)

An example [Traefik](https://doc.traefik.io/traefik/) setup that terminates
HTTPS and gates the whole app behind HTTP Basic Auth, per
[`docs/design.md` §7.2](../../../docs/design.md). It layers on top of the base
[`docker-compose.yml`](../../../docker-compose.yml) as a
[Compose override](https://docs.docker.com/compose/multiple-compose-files/merge/)
— the base file is unmodified.

Only the **frontend** is routed (the default single-origin setup): its own
nginx proxies `/api` to the backend over the Compose network, so this one
Basic Auth also protects the API and there is no CORS to configure. If you
instead run the backend on its own public origin, see
[`docs/design.md` §7.2](../../../docs/design.md) and the
[X-API-Key section of the README](../../../README.md#external-access-x-api-key--vpntailscale)
— Basic Auth is not sent cross-origin by the SPA.

## 1. Generate the Basic Auth credentials

```bash
# Needs the `htpasswd` tool (apache2-utils/httpd-tools), or run it via Docker:
docker run --rm httpd:2.4-alpine htpasswd -nB <username> > deploy/reverse-proxy/traefik/htpasswd
```

You'll be prompted for a password (with the Docker form, pipe it in or type
it when prompted before the container exits). The resulting `htpasswd` file
is bcrypt-hashed and gitignored — never commit it.

## 2. Configure

```bash
cp deploy/reverse-proxy/traefik/.env.example deploy/reverse-proxy/traefik/.env
# then edit DOMAIN (and ACME_EMAIL for Option A) in that file
```

## 3. Pick a TLS option

**Option A — Let's Encrypt** (public domain, ports 80+443 reachable from the
internet): the default in `docker-compose.override.yml`. Set `DOMAIN` and
`ACME_EMAIL` in `.env` and skip to step 4 — Traefik requests and renews the
certificate automatically via the HTTP-01 challenge.

**Option B — self-signed (LAN-only)**:

```bash
mkdir -p deploy/reverse-proxy/traefik/dynamic
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout deploy/reverse-proxy/traefik/dynamic/selbstbehalt.key \
  -out deploy/reverse-proxy/traefik/dynamic/selbstbehalt.crt \
  -subj "/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},IP:<your-lan-ip>"
cp deploy/reverse-proxy/traefik/dynamic/tls.yml.example deploy/reverse-proxy/traefik/dynamic/tls.yml
```

Then in `docker-compose.override.yml`, delete the
`traefik.http.routers.selbstbehalt.tls.certresolver=letsencrypt` label —
Traefik falls back to the cert served by the file provider above. Since the
cert is self-signed, import `selbstbehalt.crt` into each client device's trust
store (or accept the browser warning once) — otherwise the PWA install
prompt and the offline service worker (which needs a trusted origin) won't
work reliably.

## 4. Run

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/reverse-proxy/traefik/docker-compose.override.yml \
  --env-file .env --env-file deploy/reverse-proxy/traefik/.env \
  up -d --build
```

Browse to `https://<DOMAIN>`; the browser prompts for the Basic Auth
credentials from step 1, then loads the app.

## Notes

- Plain HTTP (`:80`) always redirects to HTTPS — see
  [`docs/design.md` §7.2](../../../docs/design.md) ("HTTPS: Pflicht").
- Traefik needs read access to the Docker socket to discover containers via
  labels. That is a meaningful privilege boundary in itself; if you'd rather
  not grant it directly, put a
  [`docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
  in front and point `--providers.docker.endpoint` at it instead.
- `crossorigin="use-credentials"` on the app's manifest link (`app.html`)
  already makes the browser send the stored Basic Auth when fetching the
  manifest/icons, so the PWA install prompt works out of the box behind this
  proxy — no extra configuration needed here.
