# SPDX-License-Identifier: Apache-2.0
#
# Only needed for Option C (DNS-01) — Options A and B run the stock
# `caddy:<version>-alpine` image straight from docker-compose.override.yml.
#
# The DNS-01 challenge needs a DNS provider module compiled into the Caddy
# binary, and the official image ships none. CADDY_DNS_MODULE is a build arg so
# this example stays provider-neutral: pass the module for your own provider.
# The full list lives at https://github.com/caddy-dns.
#
# Built through Compose (see docker-compose.override.yml), or directly:
#
#     docker build deploy/reverse-proxy/caddy \
#       --build-arg CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare \
#       -t selbstbehalt-caddy
#
# Verify the module made it in:
#
#     docker run --rm selbstbehalt-caddy caddy list-modules | grep dns.providers

ARG CADDY_VERSION=2.11

FROM caddy:${CADDY_VERSION}-builder-alpine AS builder

# e.g. github.com/caddy-dns/cloudflare, github.com/caddy-dns/hetzner,
# github.com/caddy-dns/desec — whichever provider hosts your zone.
ARG CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare
RUN xcaddy build --with "${CADDY_DNS_MODULE}"

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
