<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0006: Günstigerprüfung pro versicherter Person × Leistungsjahr, nicht pro Rechnung

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Epic #146 |
| **Kapitel** | [`architecture.md`](../architecture.md) §8.5.1, §6.3 |

## Kontext

Die erste Fassung bewertete jede Rechnung für sich. Drei Eigenschaften der
PKV widersprechen dem: der Selbstbehalt ist eine Jahresgröße, der BRE-Verlust
fällt pro Jahr genau einmal an (und erst bei tatsächlich ausgezahlter
Erstattung), und maßgeblich ist das Leistungsjahr der Position
(`treatment_date`), nicht Rechnungs- oder Einreichungsdatum.

## Entscheidung

Aggregationseinheit ist **versicherte Person × Leistungsjahr**. Alle
Positionen eines Jahres (ohne `review = neu`) bilden `R_Y`; das Verdikt gilt
all-or-nothing für das Jahr. Eine Einzelrechnung zeigt nur ihren
Beitrag (Marginalanzeige) und kein eigenes Verdikt.

## Betrachtete Alternativen

- **Verdikt je Rechnung** — kann den Selbstbehalt nicht richtig anrechnen und
  würde den BRE-Verlust je Rechnung mehrfach zählen.
- **Verdikt je Vertrag** — Selbstbehalt und BRE liegen je versicherter Person,
  nicht je Vertrag (§5.5).

## Konsequenzen

- Es gibt **eine** Engine (`utils/guenstiger-pruefung.ts`), die alle Ansichten
  benutzen; keine zweite Rechnung in einer Ansicht.
- Sammelrechnungen über einen Jahreswechsel verteilen sich auf zwei Jahre.
- Die Ansichten brauchen die Positionen aller Rechnungen des Jahres bzw. den
  Roll-up `/api/stats/positions/:id`.
