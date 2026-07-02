# nginx reverse proxy (HTTPS + Basic Auth)

A standalone [nginx](https://nginx.org/) reverse proxy that terminates HTTPS
and gates the app behind HTTP Basic Auth, per
[`docs/design.md` §7.2](../../../docs/design.md). It layers on top of the base
[`docker-compose.yml`](../../../docker-compose.yml) as a
[Compose override](https://docs.docker.com/compose/multiple-compose-files/merge/)
— the base file is unmodified. Prefer Traefik's automatic TLS/routing? See
[`../traefik/`](../traefik/) instead; both examples cover the same two TLS
options.

Only the **frontend** is proxied (the default single-origin setup): its own
nginx proxies `/api` to the backend over the Compose network, so this one
Basic Auth also protects the API and there is no CORS to configure.

## 1. Generate the Basic Auth credentials

```bash
# Needs the `htpasswd` tool (apache2-utils/httpd-tools), or run it via Docker:
docker run --rm httpd:2.4-alpine htpasswd -nB <username> > deploy/reverse-proxy/nginx/htpasswd
```

The resulting `htpasswd` file is bcrypt-hashed and gitignored — never commit
it.

## 2. Edit the site config

Open [`selbstbehalt.conf`](selbstbehalt.conf) and replace every occurrence of
`pkv.example.com` with your real hostname (or a LAN name for Option B, e.g.
`pkv.local`).

## 3. Pick a TLS option

**Option A — Let's Encrypt** (public domain, ports 80+443 reachable from the
internet), via [certbot](https://certbot.eff.org/)'s webroot plugin:

```bash
mkdir -p deploy/reverse-proxy/nginx/certbot-webroot deploy/reverse-proxy/nginx/certbot-etc

# Start the proxy first so it can serve the ACME HTTP-01 challenge on :80 —
# the HTTPS server block will fail to start without a cert yet, that's fine,
# certbot only needs the :80 challenge location.
docker compose \
  -f docker-compose.yml -f deploy/reverse-proxy/nginx/docker-compose.override.yml \
  --env-file .env up -d frontend backend nginx-proxy

docker run --rm \
  -v "$(pwd)/deploy/reverse-proxy/nginx/certbot-webroot:/var/www/certbot" \
  -v "$(pwd)/deploy/reverse-proxy/nginx/certbot-etc:/etc/letsencrypt" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d pkv.example.com --email you@example.com --agree-tos

docker compose \
  -f docker-compose.yml -f deploy/reverse-proxy/nginx/docker-compose.override.yml \
  --env-file .env restart nginx-proxy
```

Certificates expire after 90 days. Renew with the same `certbot ... renew`
image on a schedule (e.g. a monthly host cron job calling `docker run --rm
-v ... certbot/certbot renew` followed by `docker compose restart
nginx-proxy`) — this example does not automate renewal itself.

**Option B — self-signed (LAN-only)**:

```bash
mkdir -p deploy/reverse-proxy/nginx/certs
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout deploy/reverse-proxy/nginx/certs/selbstbehalt.key \
  -out deploy/reverse-proxy/nginx/certs/selbstbehalt.crt \
  -subj "/CN=pkv.local" \
  -addext "subjectAltName=DNS:pkv.local,IP:<your-lan-ip>"
```

Then in `selbstbehalt.conf`, comment out the two `Option A` `ssl_certificate*`
lines and uncomment the `Option B` ones. Since the cert is self-signed, import
`selbstbehalt.crt` into each client device's trust store (or accept the
browser warning once) — otherwise the PWA install prompt and the offline
service worker (which needs a trusted origin) won't work reliably.

## 4. Run

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/reverse-proxy/nginx/docker-compose.override.yml \
  --env-file .env \
  up -d --build
```

Browse to `https://<your-hostname>`; the browser prompts for the Basic Auth
credentials from step 1, then loads the app.

## Notes

- Plain HTTP (`:80`) always redirects to HTTPS except for the ACME challenge
  path — see [`docs/design.md` §7.2](../../../docs/design.md) ("HTTPS:
  Pflicht").
- `crossorigin="use-credentials"` on the app's manifest link (`app.html`)
  already makes the browser send the stored Basic Auth when fetching the
  manifest/icons, so the PWA install prompt works out of the box behind this
  proxy — no extra configuration needed here.
