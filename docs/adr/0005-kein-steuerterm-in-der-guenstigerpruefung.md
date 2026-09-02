<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0005: Kein §33-EStG-Steuervorteil in der Günstigerprüfung

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #64 (*not planned*) |
| **Kapitel** | [`architecture.md`](../architecture.md) §8.5.4 |

## Kontext

Selbst getragene Krankheitskosten können als außergewöhnliche Belastung
(§33 EStG) steuerlich wirken. Ein vollständiges Modell müsste diesen Vorteil
in die Entscheidung einreichen vs. selbst zahlen einrechnen.

## Entscheidung

Die Regel bleibt `max(0, R_Y − S) > NPV(ΔBRE)` — **ohne Steuerterm**. Das
ist eine bewusste Scope-Entscheidung, keine Lücke.

## Betrachtete Alternativen

- **Steuerterm mit Nutzereingabe (Grenzsteuersatz, zumutbare Belastung)** —
  die zumutbare Belastung hängt von Gesamteinkommen, Familienstand und
  Kinderzahl ab; die Anwendung kennt keine dieser Größen und soll sie auch
  nicht erheben. Eine geratene Größe im Verdikt wäre schlimmer als keine.
- **Pauschaler Aufschlag** — täuscht Genauigkeit vor, die nicht existiert.

## Konsequenzen

- Das Verdikt ist konservativ: es unterschätzt den Vorteil des
  Selbstzahlens leicht.
- Der Term wird nicht wieder eingeführt; die Entscheidung steht in
  `CLAUDE.md` als Arbeitsanweisung.
