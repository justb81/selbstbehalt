<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0002: PP-OCRv6-tiny als `.onnx`, nicht als `.ort`

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Issue #317, PR #327 |
| **Kapitel** | [`architecture.md`](../architecture.md) §8.2 |

## Kontext

`ppu-paddle-ocr` 6.2.0 machte PP-OCRv6 zur Standard-Modellfamilie. Drei
Bündel standen zur Wahl (v5 latin mobile 12,3 MB / 837 Zeichen, v6 tiny
6,2 MB / 6 905 Zeichen, v6 small 29,8 MB / 18 709 Zeichen); alle decken
Deutsch vollständig ab. PP-OCRv6 liegt zusätzlich im kompakteren
`.ort`-Format vor.

## Entscheidung

**v6-tiny** — kleiner und schneller als der Vorgänger, und das Wörterbuch
bleibt eng genug, dass der Erkenner keine CJK-Glyphe auf eine deutsche
Rechnung schreibt. Ausgeliefert wird das schlichte **`.onnx`**: die
`.ort`-Variante scheitert browserverifiziert auf dem WebGPU-/JSEP-Pfad
(`ResolveKernelTypeStr … com.ms.internal.nhwc:Conv:1` — der
NHWC-Layout-Transform wird bei der ORT-Konvertierung nicht mitgeliefert),
während `.onnx` über WebGPU **und** WASM lädt, im Hauptthread wie im Worker.

## Betrachtete Alternativen

- **v5 latin mobile behalten** — doppelt so groß, ältere Modellgeneration.
- **v6 small** — fünfmal so groß; das 18 709-Zeichen-Wörterbuch erlaubt
  Fehlerkennungen außerhalb der lateinischen Domäne. Die Herstellerangabe zur
  Genauigkeit stammt aus einem Kassenbon-Benchmark, nicht von GOÄ-Rechnungen.
- **`.ort` mit WebGPU→WASM-Retry** — verlangt zuerst einen Rückfall bei
  fehlgeschlagener Session-Erstellung, den `handleInit` heute nicht hat; ohne
  ihn schlägt die OCR auf jedem WebGPU-fähigen Browser hart fehl.

## Konsequenzen

- Modellbudget ~6 MB statt 12,3 MB; WebGPU bleibt nutzbar.
- Rollback auf v5-latin ist mechanisch ein Ein-Datei-/Zwei-Hash-Change
  (`scripts/fetch-ocr-models.mjs`, `models.sha256`).
- Eine formale Qualitätsmessung an echten Rechnungen steht aus und darf aus
  Datenschutzgründen nur lokal laufen (§8.2).
