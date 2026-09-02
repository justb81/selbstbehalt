<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0010: Single-Origin — das Frontend-nginx proxyt `/api`

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Self-Hosting-Setup; CSRF-Schutz Issue #404 |
| **Kapitel** | [`architecture.md`](../architecture.md) §7.3; [`hardening.md`](../hardening.md) |

## Kontext

Die Authentifizierung soll ohne App-eigene Nutzerverwaltung auskommen:
HTTP Basic Auth am Reverse Proxy. Ein Browser sendet Basic Auth aber nicht
cross-origin — ein Backend auf eigener Origin läge außerhalb des Schutzes
und bräuchte CORS.

## Entscheidung

Im Standardbetrieb spricht der Browser mit **einer** Origin: das Frontend-nginx
leitet `/api` intern an das Backend weiter, `PUBLIC_API_URL` bleibt leer. Die
Basic Auth des Proxy deckt damit die API mit ab, CORS entsteht nicht. Der
Betrieb auf getrennter Origin bleibt die dokumentierte Ausnahme mit
`X-API-Key` und explizitem `CORS_ORIGINS`.

## Betrachtete Alternativen

- **Backend auf eigener Origin als Standard** — verlangt App-Auth oder Token
  für jeden Betreiber und öffnet CORS.
- **App-eigene Nutzerverwaltung** — Aufwand und Angriffsfläche für einen
  Haushalt, den der Proxy ohnehin schützt.

## Konsequenzen

- Beide Compose-Services veröffentlichen keine Host-Ports.
- Ambient-Authentifizierung braucht CSRF-Schutz: `hono/csrf` plus
  `Sec-Fetch-Site`-Guard, `CORS_ORIGINS` als explizite Schreib-Allowlist
  (`*` weitet nicht aus).
- Das Web-App-Manifest wird mit `crossorigin="use-credentials"` geladen,
  sonst scheitert die Installation hinter Basic Auth (§8.6).
