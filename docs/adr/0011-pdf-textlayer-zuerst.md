<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0011: PDF-Textlayer zuerst, OCR nur als Rückfall je Seite

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #278 |
| **Kapitel** | [`architecture.md`](../architecture.md) §6.1 |

## Kontext

Viele Rechnungen kommen als digital erzeugtes PDF (Praxissoftware, „als PDF
drucken"). Diese tragen einen Textlayer, der die Erkennung überflüssig macht.
Ein mehrseitiges PDF kann aber digitale und gescannte Seiten mischen.

## Entscheidung

`pdfjs` liest den Textlayer **je Seite** (`getTextContent()`); eine
Brauchbarkeits-Heuristik (Zeichenzahl, druckbare Zeichen, Ziffern-/EUR-/
Datumsmuster) entscheidet pro Seite. Nur Seiten ohne brauchbaren Textlayer
werden rasterisiert und durch die OCR geschickt. Beide Pfade münden in
derselben `OcrResult[]`-Form (Textlayer-Zeilen mit `confidence: 1`).

## Betrachtete Alternativen

- **Immer rasterisieren und OCR** — verschenkt Geschwindigkeit und
  Genauigkeit bei digitalen PDFs.
- **Entscheidung pro Dokument** — scheitert an gemischten PDFs.

## Konsequenzen

- Parser und Review-Screen unterscheiden die Quelle nicht.
- Textlayer-Seiten haben kein Bild: die Seitenvorschau führt sie als
  `kind: 'text'` (Issue #362), die Qualitätsprüfung bewertet sie nicht.
