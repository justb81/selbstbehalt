# Changelog

## [1.8.0](https://github.com/justb81/selbstbehalt/compare/v1.7.1...v1.8.0) (2026-07-08)

### Features

- add "Arznei-/Hilfsmittel" position category (Anzahl × Basis) ([#248](https://github.com/justb81/selbstbehalt/issues/248)) ([3b2318c](https://github.com/justb81/selbstbehalt/commit/3b2318ca6c2ca3cc273499387bd0e770f15864fa)), closes [#82](https://github.com/justb81/selbstbehalt/issues/82) [#83](https://github.com/justb81/selbstbehalt/issues/83) [#84](https://github.com/justb81/selbstbehalt/issues/84)
- **frontend:** Selbstbehalt-Ausschöpfung & Einreich-Schwellen-Radar ([#234](https://github.com/justb81/selbstbehalt/issues/234)) ([#246](https://github.com/justb81/selbstbehalt/issues/246)) ([4c92c05](https://github.com/justb81/selbstbehalt/commit/4c92c05f967c5650274f1cbf5f2f076ff174551d))

## [1.7.1](https://github.com/justb81/selbstbehalt/compare/v1.7.0...v1.7.1) (2026-07-08)

### Bug Fixes

- **frontend:** show invoice Person tabs for every insured person ([#244](https://github.com/justb81/selbstbehalt/issues/244)) ([636d3d5](https://github.com/justb81/selbstbehalt/commit/636d3d50872acc2119b71880f5a573e17a0afffb))

## [1.7.0](https://github.com/justb81/selbstbehalt/compare/v1.6.0...v1.7.0) (2026-07-07)

### Features

- **backend:** add positions-based stats aggregation endpoints ([#239](https://github.com/justb81/selbstbehalt/issues/239)) ([#240](https://github.com/justb81/selbstbehalt/issues/240)) ([55ba2ca](https://github.com/justb81/selbstbehalt/commit/55ba2ca36f577cd398757fdf202a7f26e4f25702))
- **frontend:** shared, filterable invoice list on both invoice pages ([#242](https://github.com/justb81/selbstbehalt/issues/242)) ([4399204](https://github.com/justb81/selbstbehalt/commit/43992045641695f0133b0e5886245fc94c8f99e7))

### Bug Fixes

- **gcp:** break BRE streak only when reimbursements exceed the Selbstbehalt ([#241](https://github.com/justb81/selbstbehalt/issues/241)) ([abb8541](https://github.com/justb81/selbstbehalt/commit/abb854190ea3c4be8a59b4694007fe53ea1dc975))

## [1.6.0](https://github.com/justb81/selbstbehalt/compare/v1.5.1...v1.6.0) (2026-07-07)

### Features

- **invoices:** allow stepping back a status transition (delete or edit) ([#233](https://github.com/justb81/selbstbehalt/issues/233)) ([5e8564b](https://github.com/justb81/selbstbehalt/commit/5e8564b2d02afd64aebfce3520dd30e84ac2c053)), closes [#230](https://github.com/justb81/selbstbehalt/issues/230)

### Bug Fixes

- **frontend:** remove unused Steuervorteil (§33 EStG) scaffold from GCP ([#231](https://github.com/justb81/selbstbehalt/issues/231)) ([9ba7697](https://github.com/justb81/selbstbehalt/commit/9ba76978ca6090552026b390556950f60ce302ac)), closes [#64](https://github.com/justb81/selbstbehalt/issues/64)

## [1.5.1](https://github.com/justb81/selbstbehalt/compare/v1.5.0...v1.5.1) (2026-07-07)

### Bug Fixes

- always show the invoice scanner/dropzone ([#228](https://github.com/justb81/selbstbehalt/issues/228)) ([33513eb](https://github.com/justb81/selbstbehalt/commit/33513eb9e0cd5c2161fa466ff4e5c07e901aa88b))

## [1.5.0](https://github.com/justb81/selbstbehalt/compare/v1.4.1...v1.5.0) (2026-07-07)

### Features

- **frontend:** capture beforeinstallprompt to surface an install prompt ([#226](https://github.com/justb81/selbstbehalt/issues/226)) ([5e1c10e](https://github.com/justb81/selbstbehalt/commit/5e1c10ec483d69adba0a4451c56b87b8846a86b5))

## [1.4.1](https://github.com/justb81/selbstbehalt/compare/v1.4.0...v1.4.1) (2026-07-06)

### Bug Fixes

- **zod:** adapt to zod v4 breaking changes ([#222](https://github.com/justb81/selbstbehalt/issues/222)) ([ded2ad7](https://github.com/justb81/selbstbehalt/commit/ded2ad760410b5eb84f60c10ad41e517118e041b))

## [1.4.0](https://github.com/justb81/selbstbehalt/compare/v1.3.0...v1.4.0) (2026-07-04)

### Features

- **medic-invoice-check:** minimize/maximize GOÄ/GOZ positions ([#207](https://github.com/justb81/selbstbehalt/issues/207)) ([#211](https://github.com/justb81/selbstbehalt/issues/211)) ([d49c220](https://github.com/justb81/selbstbehalt/commit/d49c220d2936be49b9d5fbaa9f2b1676312ccd3c))

### Bug Fixes

- **scripts:** fall back to the Wayback Machine when gesetze-im-internet.de is unreachable from CI ([#209](https://github.com/justb81/selbstbehalt/issues/209)) ([8aeda89](https://github.com/justb81/selbstbehalt/commit/8aeda89698ecc8fc3f6e871d61238d8054731b1d))

## [1.3.0](https://github.com/justb81/selbstbehalt/compare/v1.2.0...v1.3.0) (2026-07-02)

### Features

- Cross-promote GOÄ-Wächter demo and GitHub repo; document full rule scope ([#203](https://github.com/justb81/selbstbehalt/issues/203)) ([1436e21](https://github.com/justb81/selbstbehalt/commit/1436e21a546c3d5ff88ab8d9aa233e4bb1cc04fb))

### Bug Fixes

- format and alert ([#201](https://github.com/justb81/selbstbehalt/issues/201)) ([e38770b](https://github.com/justb81/selbstbehalt/commit/e38770b72e1bf2157f3a1ae6d2fc2108df5053b5))

## [1.2.0](https://github.com/justb81/selbstbehalt/compare/v1.1.0...v1.2.0) (2026-07-02)

### Features

- add apps/goae-waechter demo PWA (issue [#170](https://github.com/justb81/selbstbehalt/issues/170)) ([#189](https://github.com/justb81/selbstbehalt/issues/189)) ([933431f](https://github.com/justb81/selbstbehalt/commit/933431fb11f1a1cd89e8268dec512d4de82415f6))
- deploy GOÄ-Wächter to GitHub Pages (issue [#171](https://github.com/justb81/selbstbehalt/issues/171)) ([#191](https://github.com/justb81/selbstbehalt/issues/191)) ([8e2539d](https://github.com/justb81/selbstbehalt/commit/8e2539dd8f4cd9cf2356d4cfba4604693edb7462))
- harden CSP/security headers, add reverse-proxy examples (issue [#31](https://github.com/justb81/selbstbehalt/issues/31)) ([#196](https://github.com/justb81/selbstbehalt/issues/196)) ([33a8c74](https://github.com/justb81/selbstbehalt/commit/33a8c743eb7110f81045ef44560339a693410270))

### Bug Fixes

- copy packages/medic-invoice-check into frontend Docker build ([#192](https://github.com/justb81/selbstbehalt/issues/192)) ([1ca04c0](https://github.com/justb81/selbstbehalt/commit/1ca04c0e0d0806644e49d4b4e08269e51f6a8f88))
- prevent polynomial ReDoS in GOÄ invoice header regexes ([#194](https://github.com/justb81/selbstbehalt/issues/194)) ([7ac25ef](https://github.com/justb81/selbstbehalt/commit/7ac25efc885e1774531c6806cabe07e03efddb5e))

## [1.1.0](https://github.com/justb81/selbstbehalt/compare/v1.0.0...v1.1.0) (2026-07-01)

### Features

- implement /stats Jahresauswertung with year selector and charts ([#28](https://github.com/justb81/selbstbehalt/issues/28)) ([#185](https://github.com/justb81/selbstbehalt/issues/185)) ([551c414](https://github.com/justb81/selbstbehalt/commit/551c414dc570953d4ec292cdb8f4f5c4b7a4831b))

## 1.0.0 (2026-07-01)

### Features

- **release:** adopt release-please for SemVer + GHCR release pipeline ([#181](https://github.com/justb81/selbstbehalt/issues/181)) ([8f18164](https://github.com/justb81/selbstbehalt/commit/8f1816463a9644247c888d1081e73b2d066cff80)), closes [#33](https://github.com/justb81/selbstbehalt/issues/33)

## Changelog

All notable changes to this project are documented in this file, generated
automatically by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commits](https://www.conventionalcommits.org/). See
[`docs/release.md`](docs/release.md) for the release process.
