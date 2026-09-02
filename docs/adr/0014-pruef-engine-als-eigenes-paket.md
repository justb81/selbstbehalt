<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0014: Die Prüf-Engine ist ein eigenes Paket (`medic-invoice-check`)

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | GOÄ-Wächter-Demo (Epic #166) |
| **Kapitel** | [`architecture.md`](../architecture.md) §5.3, §5.6 |

## Kontext

Neben der selbst gehosteten App gibt es die öffentliche GOÄ-Wächter-Demo auf
GitHub Pages: dieselbe Rechnungsprüfung, ohne Backend, ohne Tarife. Zwei
Parser oder zwei Scan-Oberflächen würden auseinanderlaufen.

## Entscheidung

OCR-Pipeline, Gebührenordnungs-Parser und Regelprüfung sowie die Scan- und
Review-Oberfläche liegen einmal in `packages/medic-invoice-check`,
framework-leicht und backendfrei. Frontend und Demo konsumieren das Paket;
alles Tarif- und Erstattungsbezogene (`eligible_amount`, Leistungsbereich-
Picker) bleibt außerhalb bzw. hinter Props.

## Betrachtete Alternativen

- **Demo als Build-Variante des Frontends** — zieht API-Client, Stores und
  Tariflogik in eine Seite, die nichts davon braucht.
- **Parser kopieren** — zwei Regelwerke, doppelte Tests, garantierte Drift.

## Konsequenzen

- Das Paket kennt keine Tarife und keinen Server.
- Die shadcn-Primitiven, die es mit den Apps teilt, liegen in
  `packages/ui` (ADR-0017).
