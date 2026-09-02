<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0013: Stille Kennzeichnung statt Push-Benachrichtigungen

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #288 (Zahlungserinnerungen) |
| **Kapitel** | [`architecture.md`](../architecture.md) §8.6 |

## Kontext

Zahlungsziele und Fristen sollen dem Nutzer nicht entgehen. Web-Push
verlangt einen Push-Dienst des Browser-Herstellers und einen Server, der
sendet.

## Entscheidung

Fälligkeiten werden **nur in der Oberfläche** gekennzeichnet
(`PaymentDueBadge`, Dashboard), gesteuert über drei Einstellungen
(`defaultPaymentTermDays`, `paymentReminderLeadDays`,
`paymentRemindersEnabled`). Keine Push-, keine OS-Benachrichtigung.

## Betrachtete Alternativen

- **Web Push** — der Push-Dienst ist ein Laufzeit-Dritter (§2.1), und das
  Backend ist bewusst kein Sender (§2.2).
- **Lokale Notification API ohne Server** — funktioniert nur bei geöffneter
  App und bringt gegenüber der Kennzeichnung nichts.

## Konsequenzen

- Erinnerungen wirken nur, wenn die App geöffnet wird.
- Kein zusätzlicher Dienst, keine Zustellungs-Fehlerfälle.
