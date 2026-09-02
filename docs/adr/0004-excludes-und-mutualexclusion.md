<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0004: `excludes` und `mutualExclusion` bleiben zwei Formen

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Datenformat-Entwurf (Issue #15) |
| **Kapitel** | [`data-format.md`](../data-format.md) §5.2.1; [`architecture.md`](../architecture.md) §8.3 |

## Kontext

Die Gebührenordnungen formulieren Unverträglichkeiten zweifach: gerichtet an
einer Ziffer („neben Nr. 1 nicht berechnungsfähig") und als symmetrische
Gruppe in einem Satz („Nummern 271–276 nicht nebeneinander"). Für die reine
Konflikterkennung wären beide auf eine Menge von Paaren reduzierbar.

## Entscheidung

Beide Formen bleiben im Datenformat erhalten: `excludes` als gerichtete
Kante am Eintrag, `mutualExclusion` als Gruppe mit **einer** `id` und
**einem** `sourceText`. Der Parser normalisiert beide für die Prüfung zu
derselben symmetrischen Paarmenge (ein Prüfpfad), zeigt aber die
ursprüngliche Regel-Identität an.

## Betrachtete Alternativen

- **Alles zu `excludes`-Paaren auflösen** — verliert die Klammer des
  Gesetzessatzes: die Anzeige könnte nicht mehr „Regel `excl-271-276`
  angewendet auf 271, 274" sagen, sondern nur eine anonyme Paarmenge; die
  einmalige Pflege je Regel ginge ebenfalls verloren.

## Konsequenzen

- Der Validator prüft beide Formen getrennt.
- `excludes` ist symmetrisch zu behandeln — das Gesetz nennt die Kante meist
  nur einseitig.
