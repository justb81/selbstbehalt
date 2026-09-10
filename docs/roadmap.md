<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Implementierungs-Roadmap

Aktueller Umsetzungsstand und offene Issues. Vollständige technische Spezifikation:
[`docs/architecture.md`](./architecture.md). Details zu abgeschlossenen Phasen:
[`CHANGELOG.md`](../CHANGELOG.md) und die jeweiligen GitHub-Issues.

**Status-Legende:** ✅ erledigt · ◐ teilweise umgesetzt · ⬜ offen · ❌ verworfen (als „not planned" geschlossen; die Zeile bleibt stehen, damit die Entscheidung nachvollziehbar ist).

## Label-Schema

- **type:** `type:feature`, `type:domain`, `type:infra`, `type:ci-cd`, `type:test`, `type:security`, `type:docs`
- **area:** `area:frontend`, `area:backend`, `area:database`, `area:domain-logic`, `area:ocr`, `area:pwa`, `area:devops`
- **phase:** `phase:0-foundation`, `phase:1-mvp`, `phase:2-ocr`, `phase:3-polish`, `phase:4-extensions`
- **priority:** `priority:high`, `priority:medium`, `priority:low`
- **sonstige:** `privacy` (Privacy-by-Design-relevant), `epic` (Meta/Übersicht)
- **gemeldete Issues:** Über die Issue-Templates eingereichte Issues nutzen die GitHub-Standard-Labels (`bug`, `enhancement`, `documentation`, `question`, …); die obige `type:`/`area:`/`phase:`-Taxonomie ist primär für die geplanten Umsetzungs-Issues gedacht.

## Abgeschlossene Phasen

| Phase | Umfang | Status |
|---|---|---|
| 0 — Fundament & DevEx | Monorepo, TS/ESLint/Prettier, Test-Infra, CI, Security-Auto, Repo-Meta | ✅ abgeschlossen — siehe CHANGELOG |
| 1 — MVP: Backend, Domäne & Frontend | DB, Hono-API, Schemas, GOÄ-Parser, Erstattungs-Engine, Günstigerprüfung, SvelteKit-UI, Docker | ✅ abgeschlossen — siehe CHANGELOG |
| 1.1 — Günstigerprüfung-Redesign (Epic #146) | Pro versicherte Person × Leistungsjahr, NPV-Abzinsung, Mehrjahres-Leiter (#139–#142, #134) | ✅ abgeschlossen — siehe CHANGELOG; Folge-Issues #144/#145 offen |
| 2 — OCR (client-seitig) | PP-OCRv6 via Web Worker (WebGPU/WASM), Bildvorverarbeitung, Scan-Flow | ✅ abgeschlossen — siehe CHANGELOG |
| 3 — PWA, Auswertung, Polish, Security & Release | PWA + Offline-Queue, Jahresauswertung, A11y, Hardening, GHCR-Release, Docs, Navigation | ✅ abgeschlossen — siehe CHANGELOG |

## Offene Issues

| Issue | Titel | Status |
|---|---|---|
| #184 | CSV/PDF-Export der Jahresauswertung | ⬜ |
| #316 | Zuschnitt auf den bedruckten Bereich via `detect()` | ⬜ |
| #317 | PP-OCRv6 als Modellfamilie evaluieren — Qualitätsvergleich an echten Rechnungen (lokal beim Maintainer) | ◐ |
| #144 | BRE-Auszahlungsmonat pro Vertrag konfigurierbar | ⬜ |
| #145 | `p` datengetrieben aus der Historie schätzen | ⬜ |
| #36 | Beihilfe-Unterstützung | ⬜ |
| #39 | Native Android-App via Tauri *(mit Maintainer abstimmen)* | ⬜ |
| #85 | Beleg-OCR/-Parser für Apotheken-/Hilfsmittel-Belege (PZN/HMV) | ⬜ |

## Verworfene Entscheidungen (zur Nachvollziehbarkeit)

| Issue | Titel | Status |
|---|---|---|
| #37 | Optionaler LLM-Handschrift-Fallback (Opt-in) | ❌ |
| #38 | n8n-Einreichungs-E-Mails | ❌ |
