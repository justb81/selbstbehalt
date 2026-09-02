<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0019: Filterzustand lebt in der URL, ersetzend statt anhängend

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #461 (URL-synchronisierter Filterzustand) |
| **Kapitel** | [`architecture.md`](../architecture.md) §5.2, §8.7 |

## Kontext

Die Auswertung filtert nach Leistungsjahr und versicherter Person, das
Rechnungsarchiv nach Status, Person und Art. Beides lag als lokaler
Komponenten-`$state`: Reload und Zurück-Navigation verloren die Auswahl, und
eine gefilterte Ansicht war nicht verlinkbar. Gleichzeitig verlinkte das
Dashboard bereits mit Query-String (`/invoices?submission=eingereicht`, Issue
#261) — die Leserichtung existierte also schon, nur einmalig beim Betreten der
Seite und ohne Gegenstück beim Schreiben.

## Entscheidung

Filterzustand ist **Teil der URL**, nicht des Komponenten-States. Gelesen und
geschrieben wird über die reinen Helfer in
`apps/frontend/src/lib/utils/url-state.ts` (`readParam`, `readNumberParam`,
`withParam`); die Auswahl selbst ist ein `$derived` über `page.url`, es gibt
keine zweite Kopie im State. Drei Festlegungen gehören dazu:

- **`replaceState`, nicht `pushState`.** Ein Filterwechsel erzeugt keinen
  History-Eintrag: „Zurück" führt auf die vorige Seite, nicht durch die
  Filterhistorie.
- **Der Default steht nicht in der URL.** Ein leerer oder nullish Wert entfernt
  den Parameter, statt ihn leer zu hinterlassen — die URL ohne Parameter ist der
  kanonische „kein Filter"-Zustand.
- **Ungültige Werte fallen zurück, ohne die URL umzuschreiben.** Der Rückfall auf
  den Default ist eine Leseentscheidung; ein Rewrite würde ein Lesezeichen
  stillschweigend verändern.

## Betrachtete Alternativen

- **Komponenten-`$state` beibehalten** — der Ausgangszustand. Kostet Deep-Links
  und verliert die Auswahl bei jedem Reload; auf einer Offline-PWA, die
  Neuladen provoziert, ist das der teuerste der drei Punkte.
- **Ein globaler Svelte-Store für Filter** — übersteht die Navigation innerhalb
  der Session, aber weder Reload noch Teilen eines Links, und legt eine zweite
  Quelle neben die URL. Genau die Doppelquelle, die §8.8 („eine Quelle je
  Rechnung") an anderer Stelle schon verbietet.
- **`pushState` je Filterwechsel** — macht die Auswahl zurücknehmbar, aber „Zurück"
  arbeitet sich dann durch jeden Zwischenschritt, statt die Seite zu verlassen.
  Bei einem `Select` mit fünf Jahren sind das fünf Einträge für einen Blick.
- **Ungültige Werte per Redirect korrigieren** — sieht sauberer aus, verändert
  aber ein gesetztes Lesezeichen und verdeckt einen Tippfehler im Link, statt
  ihn stehen zu lassen.

## Konsequenzen

- Gefilterte Ansichten sind verlinkbar und überstehen Reload und
  Zurück-Navigation; das Dashboard kann auf jeden Filterzustand verlinken.
- Die Parameternamen je Route sind ein **öffentlicher Vertrag** (§5.2) — sie zu
  umbenennen bricht bestehende Lesezeichen.
- Filterwechsel sind nicht per „Zurück" widerrufbar; das ist der bewusste Preis
  für eine brauchbare History.
- Jede weitere gefilterte Ansicht nutzt denselben Helfer — kein eigenes
  `searchParams.get` mit handgeschriebenem Cast mehr (Issue #466 baut die
  `InvoiceList` darauf um).
