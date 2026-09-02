<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0009: Hono + SQLite, nicht FastAPI/PostgreSQL

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Gründungsentscheidung (Issue #2 ff.) |
| **Kapitel** | [`architecture.md`](../architecture.md) §4.2, §5.4, §6.5 |

## Kontext

Das Backend ist nur Persistenz und REST (§2.2) und läuft für einen
Einzelhaushalt auf 128–256 MB RAM. Frontend und Domänenlogik sind TypeScript.

## Entscheidung

**Hono** (TypeScript) auf **SQLite** via Drizzle ORM, ein Prozess, eine
Datei unter `DATABASE_PATH`.

## Betrachtete Alternativen

- **FastAPI (Python)** — zweite Sprache, zweites Typ-Modell; die Zod-Schemas
  aus `packages/shared` wären nicht wiederverwendbar.
- **PostgreSQL** — ein weiterer Dienst mit eigenem Speicher- und
  Backup-Bedarf, für eine Datenmenge, die in eine Datei passt.

## Konsequenzen

- Ein Typ-Modell über `packages/shared` für API und Formulare.
- Backup und Portabilität sind ein Dateiexport (ADR-0015).
- Keine Mehrbenutzer-Nebenläufigkeit über Prozessgrenzen; im Heimnetz
  ausreichend.
