<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0001: OCR und Regelprüfung laufen im Client, nicht auf dem Server

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Gründungsentscheidung (Designprinzipien, [`architecture.md`](../architecture.md) §2.2) |
| **Kapitel** | [`architecture.md`](../architecture.md) §2.2, §8.1, §8.2 |

## Kontext

Rechnungsbilder und Diagnosen sind Gesundheitsdaten nach Art. 9 DSGVO. Die
bestehenden PKV-Apps verarbeiten sie in der Cloud — genau das ist der Grund,
warum diese Anwendung existiert. Zugleich soll der Server auf Kleinsthardware
(128 MB RAM, kein GPU) laufen.

## Entscheidung

Texterkennung und Gebührenordnungs-Prüfung laufen vollständig im Browser
(Web Worker, WebGPU mit WASM-Rückfall). Das Backend erhält ausschließlich
strukturierte Metadaten — kein Bild, kein OCR-Rohtext als Pflichtfeld. Der
Datenfluss „Bild zum Server" existiert nicht und muss deshalb auch nicht
abgesichert werden.

## Betrachtete Alternativen

- **Serverseitiges OCR (PaddleOCR/Tesseract im Container)** — braucht CPU/GPU
  und Speicher, den die Zielhardware nicht hat, und macht das Bild zum
  Server-Datum, das gesichert, gelöscht und im Backup bedacht werden müsste.
- **Externer OCR-/LLM-Dienst** — Übermittlung von Art.-9-Daten an Dritte;
  verletzt das erste Qualitätsziel und die Randbedingung „kein Laufzeit-Dritter".

## Konsequenzen

- Backend ohne Modell, ohne GPU, ohne Hintergrundjob (§5.4).
- Die Fachlogik liegt im Bundle und muss dort getestet werden; die schweren
  Laufzeit-Assets (~6 MB Modelle, ~38 MB ONNX-Runtime-WASM) werden von der
  eigenen Origin ausgeliefert und vom Service Worker gecacht (§8.6).
- Erkennungsqualität hängt vom Gerät des Nutzers ab; eine Referenzmessung an
  echten Rechnungen darf nur lokal beim Maintainer laufen (§8.2).
