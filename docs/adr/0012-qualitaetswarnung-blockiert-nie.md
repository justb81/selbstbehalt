<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0012: Die Aufnahme-Qualitätswarnung blockiert nie

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #279 |
| **Kapitel** | [`architecture.md`](../architecture.md) §6.1, §11.1 |

## Kontext

Vor dem OCR-Lauf misst die Anwendung Schärfe, Helligkeit, Kontrast und
Glanz auf einer verkleinerten Kopie. Die Schwellen sind heuristisch gesetzt
und nicht an einem Referenzkorpus kalibriert — ein solcher Korpus aus echten
Rechnungen darf aus Datenschutzgründen nicht ins Repo.

## Entscheidung

Die Warnung ist **nicht blockierend**: sie nennt Ursache, Hinweis und die
beanstandete Seite, „Trotzdem erkennen" ist immer möglich.

## Betrachtete Alternativen

- **Harte Sperre unter Schwelle** — eine falsch-positive Sperre macht die
  Anwendung unbenutzbar; ohne kalibrierte Schwellen ist sie wahrscheinlich.
- **Keine Prüfung** — der Nutzer erfährt erst nach dem OCR-Lauf, dass das
  Foto unbrauchbar war.

## Konsequenzen

- Dieselben Metriken speisen Live-Hinweise in der Kameravorschau (#281).
- Helligkeit und Clipping dienen nur der Ursachenzuordnung, nicht als
  eigenständiger Fehler (Scanner heben Papier auf reines Weiß).
- Praktisch leere Seiten werden nicht beanstandet (`isBlankPage`, #362).
