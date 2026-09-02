<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0016: Monorepo-Schnitt — `apps/*` deploybar, `packages/*` geteilt

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #2 (Grundgerüst), rückwirkend festgehalten in Issue #446 |
| **Kapitel** | [`architecture.md`](../architecture.md) §5.1 |

## Kontext

Frontend, Backend und die GOÄ-Wächter-Demo teilen Schemas, Typen,
Domänen-Helfer, die Prüf-Engine und UI-Primitiven. Drei Repositories würden
jede Schema-Änderung zu drei Releases machen; ein einzelnes Paket vermischt
deploybare Einheiten mit Bibliothekscode.

## Entscheidung

Ein pnpm-Workspace-Monorepo mit zwei Ebenen: **`apps/*`** sind deploybare
Einheiten (je eigener Build, Dockerfile bzw. Pages-Deploy), **`packages/*`**
ist geteilter Code ohne eigenes Deployment (`shared`, `medic-invoice-check`,
`ui`), konsumiert per `workspace:*`. Werkzeuge liegen einmal im Root
(`tsconfig.base.json`, flache `eslint.config.js`, `.prettierrc.json`); die
Root-Skripte `lint`/`typecheck`/`test`/`build` fächern in die Pakete auf.

## Betrachtete Alternativen

- **Mehrere Repositories** — Typ-Drift zwischen API und Client, drei
  Release-Zyklen für eine Schema-Änderung.
- **Ein Paket ohne Workspaces** — Backend-Build zieht Svelte, Demo-Build
  zieht Drizzle; die Docker-Images werden groß und die Grenzen unsichtbar.
- **Nur `apps/`, geteilter Code per relativem Import** — ohne
  Paketgrenzen sind Abhängigkeiten nicht erzwingbar.

## Konsequenzen

- Der Docker-Build-Kontext ist das Repo-Root (die Apps brauchen
  `packages/*` und die Root-Lockdatei).
- Neuer geteilter Code geht nach `packages/*`, sobald ihn ein zweites Paket
  braucht — nicht per Kopie.
- Eine Änderung in `packages/shared` betrifft alle Konsumenten in einem PR.
