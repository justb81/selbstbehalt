<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0015: Die ganze SQLite-Datei als Export/Import, kein Feld-Export

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Backup-API (Issue #14) |
| **Kapitel** | [`architecture.md`](../architecture.md) §6.5; [`self-hosting.md`](../self-hosting.md) |

## Kontext

Ein Selbst-Hoster braucht ein Backup, das er wirklich anlegt, und Art. 20
DSGVO verlangt Portabilität der Daten.

## Entscheidung

`GET /api/export/db` liefert die SQLite-Datei als Ganzes,
`POST /api/import/db` nimmt sie als rohen Binär-Body
(`application/octet-stream` / `application/x-sqlite3`) zurück. Das ist
Backup und Portabilität in einem.

## Betrachtete Alternativen

- **JSON/CSV je Entität** — ein Format je Tabelle, ein Import mit
  Konfliktauflösung, und die Einfügereihenfolge der Ereignisse (ADR-0008)
  müsste eigens erhalten werden.
- **Nur Volume-Backup** — funktioniert, ist aber ohne Endpunkt nicht aus der
  Oberfläche erreichbar.

## Konsequenzen

- Zwei Endpunkte statt eines Formats je Entität; ein Roundtrip-Test genügt.
- Die exportierte Datei ist unverschlüsselt — Restrisiko in
  [`privacy-threat-model.md`](../privacy-threat-model.md) §6.4.
