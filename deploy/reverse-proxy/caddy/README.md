# Caddy reverse proxy (HTTPS + Basic Auth)

An example [Caddy](https://caddyserver.com/) setup that terminates HTTPS and
gates the whole app behind HTTP Basic Auth, per
[`docs/design.md` §7.2](../../../docs/design.md). It layers on top of the base
[`docker-compose.yml`](../../../docker-compose.yml) as a
[Compose override](https://docs.docker.com/compose/multiple-compose-files/merge/)
— the base file is unmodified. Prefer label-driven routing? See
[`../traefik/`](../traefik/); prefer a hand-written server block? See
[`../nginx/`](../nginx/).

Two things this example offers that the other two don't:

- **No Docker socket.** Caddy is configured statically through the
  [`Caddyfile`](Caddyfile) instead of discovering containers via labels, so the
  proxy needs no Docker privileges at all. (Traefik needs socket access, and
  its README rightly calls that "a meaningful privilege boundary in itself".)
- **A DNS-01 option** (Option C below) — a publicly trusted certificate for a
  host that is _not_ reachable from the internet. That is the normal case for
  the home-network deployments this app targets, where
  [`docs/self-hosting.md`](../../../docs/self-hosting.md) advises against
  port-forwarding.

Only the **frontend** is routed (the default single-origin setup): its own
nginx proxies `/api` to the backend over the Compose network, so this one Basic
Auth also protects the API and there is no CORS to configure. If you instead
run the backend on its own public origin, see
[`docs/design.md` §7.2](../../../docs/design.md) and the
[X-API-Key section of the README](../../../README.md#external-access-x-api-key--vpntailscale)
— Basic Auth is not sent cross-origin by the SPA.

## 1. Generate the Basic Auth credentials

```bash
cp deploy/reverse-proxy/caddy/basicauth.conf.example \
   deploy/reverse-proxy/caddy/basicauth.conf

# Prompts for the password twice and prints the bcrypt hash:
docker run --rm -it caddy:2.11-alpine caddy hash-password
```

Put your username and that hash into `basicauth.conf`, replacing
`your-username` and `REPLACE_ME`. The file is gitignored — never commit it.
Caddy has no `htpasswd` support, hence the separate file rather than a
`.env` entry: a bcrypt hash contains `$`, which Compose would expand.

`REPLACE_ME` is not a valid hash, so Caddy refuses to start until you have
actually replaced it. That is on purpose — a placeholder that fails closed
can't accidentally end up guarding your deployment.

## 2. Configure

```bash
cp deploy/reverse-proxy/caddy/.env.example deploy/reverse-proxy/caddy/.env
# then edit DOMAIN (and ACME_EMAIL for Options A and C) in that file
```

## 3. Pick a TLS option

**Option A — Let's Encrypt over HTTP-01** (public domain, ports 80+443
reachable from the internet): the default, and there is nothing to configure.
Set `DOMAIN` and `ACME_EMAIL` in `.env` and skip to step 4 — Caddy obtains and
renews the certificate on its own.

**Option B — locally-trusted certificate (LAN-only)**: uncomment `tls internal`
in the [`Caddyfile`](Caddyfile). Caddy runs its own CA and issues a certificate
for `DOMAIN` itself, renewing it automatically. Install the root certificate
once per client device — after the first start you can copy it out with:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Trusting that one root covers every host Caddy serves you, now and later, which
is why this is nicer than the self-signed per-host certificate in the other two
examples. It still matters: without a trusted certificate the PWA install
prompt and the offline service worker don't work reliably, and the scanner's
camera needs a secure context.

**Option C — Let's Encrypt over DNS-01** (no inbound ports, works for a host
that is unreachable from the internet, and the only ACME option for a purely
internal name):

1. Find your provider's module at [github.com/caddy-dns](https://github.com/caddy-dns).
   The official Caddy image ships none of them, so the binary has to be built
   with yours — that is what [`Dockerfile`](Dockerfile) does.
2. In [`docker-compose.override.yml`](docker-compose.override.yml), comment out
   `image:` and uncomment the `build:` block, setting `CADDY_DNS_MODULE` to your
   module path.
3. In `.env`, set `CADDY_DNS_PROVIDER` to the module's Caddyfile name (the last
   path element, e.g. `cloudflare`) and `DNS_API_TOKEN` to your API credential.
   Scope the credential to the single zone hosting `DOMAIN` if the provider
   allows it — DNS-01 only ever writes and deletes `_acme-challenge` TXT
   records there.
4. Uncomment the `tls { … }` block in the [`Caddyfile`](Caddyfile). **Check your
   provider module's own README for the credential syntax** — most take a
   single token as shown, some need a block with named fields.

Two DNS-01 details worth knowing before you debug a stuck issuance:

- The `propagation_delay` / `propagation_timeout` values in the Caddyfile are
  deliberately generous. Many providers acknowledge a record write immediately
  while their nameservers start answering with it minutes later, and the two
  nameservers of a zone need not agree with each other.
- Don't add `resolvers` to the `tls` block unless you know you need it. It puts
  a caching resolver into the propagation check, and `_acme-challenge.<host>`
  does not exist before the first issuance — that NXDOMAIN gets cached for your
  zone's SOA minimum, and the check cannot see past it. Check yours with
  `dig +short SOA example.com`; a value like 86400 would stall a first
  issuance for a day.

## 4. Run

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/reverse-proxy/caddy/docker-compose.override.yml \
  --env-file .env --env-file deploy/reverse-proxy/caddy/.env \
  up -d --build
```

Browse to `https://<DOMAIN>`; the browser prompts for the Basic Auth
credentials from step 1, then loads the app.

Watch the certificate being issued (useful for Options A and C, where it can
take a moment):

```bash
docker compose -f docker-compose.yml \
  -f deploy/reverse-proxy/caddy/docker-compose.override.yml logs -f caddy
```

## Notes

- Plain HTTP (`:80`) always redirects to HTTPS — that is Caddy's default and
  matches [`docs/design.md` §7.2](../../../docs/design.md) ("HTTPS: Pflicht").
- Certificates and the ACME account key live in the named volume `caddy_data`,
  not in the working tree, so no key material can be committed by accident.
  `docker compose down` keeps it; only `down -v` wipes it, which forces a
  re-issue and can run into Let's Encrypt rate limits.
- Caddy sets `X-Forwarded-For`/`-Proto`/`-Host` on proxied requests by itself
  and streams request bodies, so the 256 MiB `/api/import/db` upload needs no
  body-size limit raised here — unlike nginx, which needs an explicit
  `client_max_body_size`.
- `crossorigin="use-credentials"` on the app's manifest link (`app.html`)
  already makes the browser send the stored Basic Auth when fetching the
  manifest and icons, so the PWA install prompt works behind this proxy with no
  extra configuration.
- Upgrading Caddy: bump the tag in `docker-compose.override.yml` (Options A/B)
  or `CADDY_VERSION` in the `Dockerfile` (Option C). Under Option C the image
  must be rebuilt for the module to be recompiled against the new version.
