<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0007: Drei abgeleitete Status-Tracks statt einer `status`-Spalte

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #230 und Vorgänger |
| **Kapitel** | [`architecture.md`](../architecture.md) §5.5, §6.2 |

## Kontext

Eine Rechnung wird geprüft, bezahlt und eingereicht — und diese Vorgänge
laufen in der Wirklichkeit parallel: die Erstattung trifft meist ein, bevor
die Arztrechnung bezahlt ist. Ein linearer Status (`neu → geprüft → bezahlt →
eingereicht → erstattet`) müsste darüber lügen.

## Entscheidung

Der Zustand besteht aus drei unabhängigen Tracks — `review`
(`neu ↔ geprüft`), `payment` (`offen ↔ bezahlt`) und `submission`
(`nicht_eingereicht → eingereicht → erstattet`) — und wird **abgeleitet**:
jeder Übergang schreibt ein Ereignis nach `invoice_status_events` (mit
`track`), der aktuelle Zustand je Track ist das jüngste Ereignis
(`deriveInvoiceStatus`, View `invoice_current_status`). Es gibt keine
denormalisierte `status`-Spalte. Payment und Submission öffnen sich erst ab
`review = geprüft`; bezahlt **oder** eingereicht sperrt die Bearbeitung.

## Betrachtete Alternativen

- **Eine `status`-Spalte mit linearer Folge** — bildet „erstattet, aber noch
  nicht bezahlt" nicht ab und macht „selbst gezahlt" zu einem eigenen Status
  statt zur Kombination `bezahlt + nicht_eingereicht`.
- **Drei Spalten, direkt geschrieben** — verliert die Historie; die
  Nachvollziehbarkeit (Qualitätsziel 5) verlangt das Ereignisprotokoll.

## Konsequenzen

- Listen- und Statistikabfragen filtern über die SQL-View wie über Spalten.
- Die Reihenfolge der Ereignisse muss stabil sein — siehe ADR-0008.
- Das DTO-Feld `status` ist ein Objekt `{review, payment, submission, paid_on}`.
