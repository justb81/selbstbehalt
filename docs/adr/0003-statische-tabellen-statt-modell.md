<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0003: Statische, versionierte JSON-Tabellen für die Gebührenordnungs-Prüfung

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Gründungsentscheidung; Datenformat in Issue #15 |
| **Kapitel** | [`architecture.md`](../architecture.md) §2.2, §8.3; Format in [`data-format.md`](../data-format.md) |

## Kontext

GOÄ, GOZ und GOT sind amtliche, öffentliche und regelbasierte Werke. Die
Prüfung einer Rechnung — Steigerungsfaktor-Grenzen, Ausschlüsse,
Höchstwerte, Häufigkeiten — soll am Papier überprüfbar sein (Qualitätsziel
Nachvollziehbarkeit) und ohne Server laufen (ADR-0001).

## Entscheidung

Die Gebührenordnungen liegen als **statische JSON-Lookup-Tabellen** im Repo
(~4 500 Ziffern), **reproduzierbar erzeugt** aus den amtlichen XML-Exporten
von gesetze-im-internet.de (`pnpm fees:build`, Validator in CI). Ein
deterministischer Regex-Parser plus Regelprüfung wertet sie aus. Die Tabellen
werden ausschließlich vom Maintainer gepflegt; Fehler werden als Issue
gemeldet, nicht per Hand im JSON korrigiert.

## Betrachtete Alternativen

- **Sprachmodell zur Prüfung** — nicht deterministisch, nicht prüfbar, und
  entweder serverseitig (verboten, §2.2) oder für den Browser zu groß.
- **Hand gepflegte Tabellen** — nicht reproduzierbar; jede Korrektur wäre
  unbelegt. Die Herkunft aus dem Gesetzestext ist der Nachweis.

## Konsequenzen

- Jede Beanstandung nennt Regel und Quelle (`sourceText`) — überprüfbar.
- Das Datenformat braucht eigene Dokumentation und einen Validator
  ([`data-format.md`](../data-format.md)).
- Eine GOÄ-Reform bedeutet einen neuen Tabellenstand, keinen Code-Umbau.
