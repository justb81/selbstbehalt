<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0008: Ereignis-Reihenfolge nach `rowid`, nicht nach `changed_at`

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #288 (Zahlungsziel/Terminüberweisung) |
| **Kapitel** | [`architecture.md`](../architecture.md) §6.2 |

## Kontext

Die Statusableitung (ADR-0007) nimmt das jüngste Ereignis je Track. Ein
Zahlungsereignis trägt in `changed_at` aber das vom Nutzer angegebene
**Zahlungsdatum** — bei einer Terminüberweisung liegt das in der Zukunft.
Nach Zeitstempel geordnet würde ein späterer Revert vor der Zahlung
einsortiert.

## Entscheidung

Die Ableitung ordnet nach **Einfügereihenfolge** (`rowid`), nie nach
`changed_at`. `changed_at` ist ein fachliches Datum, kein Sortierschlüssel.

## Betrachtete Alternativen

- **Zweiter Zeitstempel `recorded_at`** — funktional gleichwertig, aber eine
  Spalte, die exakt das ausdrückt, was SQLite mit `rowid` ohnehin führt.
- **`changed_at` = Systemzeit, Zahlungsdatum als eigenes Feld** — verlangt eine
  Migration und trennt das Zahlungsdatum von dem Ereignis, das es beschreibt.

## Konsequenzen

- Terminüberweisungen sind abbildbar: `payment = bezahlt` mit `paid_on` in der
  Zukunft, nie überfällig.
- Ein Import muss die Einfügereihenfolge erhalten — der Export/Import der
  ganzen Datei (ADR-0015) tut das automatisch.
