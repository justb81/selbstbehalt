<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR-0018: Die Demo deployt aus dem release-please-Lauf, artefaktbasiert, mit Basispfad zur Build-Zeit

| | |
|---|---|
| **Status** | akzeptiert |
| **Beschlossen** | Epic #166 (GOÄ-Wächter auf GitHub Pages) |
| **Kapitel** | [`architecture.md`](../architecture.md) §7.4; Betrieb in [`deploy-goae-waechter.md`](../deploy-goae-waechter.md) |

## Kontext

Die GOÄ-Wächter-Demo ist eine statische PWA auf GitHub Pages, in einem
Projekt-Repo also unter `https://<owner>.github.io/<repo>/`. Sie soll bei jedem
Release neu veröffentlicht werden, nicht bei jedem Push, und die
`github-pages`-Umgebung erlaubt Deployments nur aus dem Default-Branch. Die
OCR-Modelle und die ONNX-Runtime-WASM (50–100 MB) gehören in den Build, nicht
ins Repo.

## Entscheidung

Drei Festlegungen in einem wiederverwendbaren Workflow (`workflow_call`):

1. **Aufruf aus `release-please.yml`**, gated auf `release_created`, statt
   eines `release: published`-Triggers — der liefe im Tag-Kontext
   (`refs/tags/vX.Y.Z`) und würde von der Branch-Schutzregel der Umgebung
   abgewiesen; der release-please-Lauf ist ein `push` auf `main` und baut
   dessen HEAD, den gerade getaggten Commit.
2. **Artefaktbasiertes Deployment** (`upload-pages-artifact` + `deploy-pages`),
   kein `gh-pages`-Branch — sonst wüchse das Repo mit jedem Deploy um die
   Modell-Binaries.
3. **Basispfad zur Build-Zeit** aus `configure-pages` (`BASE_PATH`), nicht
   hartkodiert: er fließt in `kit.paths.base`, Manifest (`start_url`, `scope`,
   Icons), Service Worker und `resolveOcrAssets(base)`. Mit einer eigenen
   Domain wird er `/`, ohne Code-Änderung.

## Betrachtete Alternativen

- **`release: published`-Trigger** — scheitert an der Umgebungsregel
  („Tag … is not allowed to deploy to github-pages"); die Regel zu lockern
  wäre ein manueller Eingriff in die Repo-Einstellungen.
- **Deploy bei jedem Push auf `main`** — Demo und Release liefen auseinander.
- **`gh-pages`-Branch** — dauerhaftes Repo-Wachstum durch Binaries.
- **Basispfad hartkodiert** — bricht beim Wechsel auf eine Domain und in Forks.

## Konsequenzen

- Demo-Stand = Release-Stand; ein manueller `workflow_dispatch` bleibt für
  Sonderfälle.
- Pages wird beim ersten Lauf per `enablement: true` selbst eingeschaltet.
- Jeder Konsument des Basispfads muss ihn aus der Umgebung nehmen; eine neue
  absolute URL im Demo-Code wäre ein Regressionsrisiko.
