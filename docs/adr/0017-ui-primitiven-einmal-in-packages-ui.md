<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0017: shadcn-Primitiven einmal in `packages/ui`, nicht je Konsument kopiert

| | |
|---|---|
| **Status** | akzeptiert — löst die vorherige Praxis „Kopie je Konsument" ab |
| **Beschlossen** | Issue #438, PR #449; festgehalten in Issue #446 |
| **Kapitel** | [`architecture.md`](../architecture.md) §8.7 |

## Kontext

shadcn-svelte vendort Komponenten als Quellcode ins Projekt statt als
Abhängigkeit — bewusst, damit sie anpassbar bleiben (§4.2). Mit drei
Konsumenten (Frontend, Demo, Prüf-Engine) lagen elf Komponenten dreifach vor
und drifteten sichtbar auseinander (Input/Select/Textarea zwischen App und
eingebettetem Review).

## Entscheidung

Jede von **mehr als einem** Paket genutzte Primitive liegt einmal in
`packages/ui` (`@selbstbehalt/ui/<komponente>`, `cn()` aus
`@selbstbehalt/ui/utils`), dort per shadcn-CLI gepflegt; nur
Frontend-eigene Komponenten bleiben unter `apps/frontend/.../components/ui`.
Braucht ein zweites Paket eine davon, wandert der Ordner. Jede App
registriert das Paket per `@source` in `app.css`.

## Betrachtete Alternativen

- **Kopie je Konsument (Status quo bis #449)** — der shadcn-Standardweg,
  aber mit drei Kopien nicht mehr pflegbar: jedes Update dreimal, Drift
  garantiert.
- **shadcn als npm-Abhängigkeit** — gibt es nicht; das Vendoring ist das
  Konzept der Bibliothek.
- **Alle UI-Komponenten in `packages/ui`, auch Frontend-eigene** — zieht
  Frontend-Spezifika in ein Paket, das die Demo mitlädt.

## Konsequenzen

- `bits-ui`, `clsx`, `tailwind-merge`, `tailwind-variants` werden nur noch
  von `packages/ui` deklariert.
- Die shadcn-CLI schreibt ins Paket; Imports werden danach relativ gemacht
  ([`packages/ui/README.md`](../../packages/ui/README.md)).
- Vendored Code bleibt vom SPDX-Header-Check ausgenommen (fremdes Copyright).
