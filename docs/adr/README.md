<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# Architecture Decision Records

Die Entscheidungen, die die Architektur festgelegt haben — je eine Datei mit
Kontext, Entscheidung, betrachteten Alternativen und Konsequenzen (MADR-nah,
Vorlage: [`0000-template.md`](./0000-template.md)). Das Entscheidungs-Log in
[`architecture.md`](../architecture.md) §9 ist die Kurzfassung und verweist
hierher; die Kapitel, in denen eine Entscheidung ausgeführt ist, stehen im Kopf
jedes ADR.

**Eine neue Entscheidung festhalten:** Vorlage kopieren, nächste Nummer
vergeben, Status `vorgeschlagen` bis zum Merge, danach `akzeptiert`; eine
Zeile in §9 ergänzen und hier eintragen. Eine Entscheidung wird nie gelöscht,
sondern durch ein neues ADR **abgelöst** (Status beider anpassen).

| ADR | Entscheidung | Status |
|---|---|---|
| [0001](./0001-ocr-und-regelpruefung-im-client.md) | OCR und Regelprüfung laufen im Client, nicht auf dem Server | akzeptiert |
| [0002](./0002-pp-ocrv6-tiny-als-onnx.md) | PP-OCRv6-tiny als `.onnx`, nicht als `.ort` | akzeptiert |
| [0003](./0003-statische-tabellen-statt-modell.md) | Statische, versionierte JSON-Tabellen für die Gebührenordnungs-Prüfung | akzeptiert |
| [0004](./0004-excludes-und-mutualexclusion.md) | `excludes` und `mutualExclusion` bleiben zwei Formen | akzeptiert |
| [0005](./0005-kein-steuerterm-in-der-guenstigerpruefung.md) | Kein §33-EStG-Steuervorteil in der Günstigerprüfung | akzeptiert |
| [0006](./0006-guenstigerpruefung-je-person-und-leistungsjahr.md) | Günstigerprüfung pro versicherter Person × Leistungsjahr | akzeptiert |
| [0007](./0007-drei-abgeleitete-status-tracks.md) | Drei abgeleitete Status-Tracks statt einer `status`-Spalte | akzeptiert |
| [0008](./0008-ereignisreihenfolge-nach-rowid.md) | Ereignis-Reihenfolge nach `rowid`, nicht nach `changed_at` | akzeptiert |
| [0009](./0009-hono-und-sqlite.md) | Hono + SQLite, nicht FastAPI/PostgreSQL | akzeptiert |
| [0010](./0010-single-origin.md) | Single-Origin — das Frontend-nginx proxyt `/api` | akzeptiert |
| [0011](./0011-pdf-textlayer-zuerst.md) | PDF-Textlayer zuerst, OCR nur als Rückfall je Seite | akzeptiert |
| [0012](./0012-qualitaetswarnung-blockiert-nie.md) | Die Aufnahme-Qualitätswarnung blockiert nie | akzeptiert |
| [0013](./0013-stille-kennzeichnung-statt-push.md) | Stille Kennzeichnung statt Push-Benachrichtigungen | akzeptiert |
| [0014](./0014-pruef-engine-als-eigenes-paket.md) | Die Prüf-Engine ist ein eigenes Paket (`medic-invoice-check`) | akzeptiert |
| [0015](./0015-sqlite-datei-als-export-und-import.md) | Die ganze SQLite-Datei als Export/Import, kein Feld-Export | akzeptiert |
| [0016](./0016-monorepo-schnitt.md) | Monorepo-Schnitt — `apps/*` deploybar, `packages/*` geteilt | akzeptiert |
| [0017](./0017-ui-primitiven-einmal-in-packages-ui.md) | shadcn-Primitiven einmal in `packages/ui`, nicht je Konsument kopiert | akzeptiert |
