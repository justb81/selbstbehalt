<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# @selbstbehalt/ui

The [shadcn-svelte](https://shadcn-svelte.com/) primitives used by more than one
workspace package — `apps/frontend`, `apps/goae-waechter` and
`@selbstbehalt/medic-invoice-check` — plus the `cn()` class helper. One vendored
copy instead of three that drift apart (issue #438).

## Usage

Each component folder is a subpath export, the helper lives under `./utils`:

```ts
import { Button } from '@selbstbehalt/ui/button';
import * as Card from '@selbstbehalt/ui/card';
import { cn } from '@selbstbehalt/ui/utils';
```

Tailwind has to see the package's classes: every consuming app lists
`@source '../../../packages/ui/src';` in its `app.css`.

Components only _one_ app uses stay in that app's own `src/lib/components/ui/`
(today: `apps/frontend`). Move a folder here the moment a second package needs it.

## Adding or updating a component

Run the shadcn-svelte CLI in this directory; `components.json` points it at
`src/lib/components/ui/`:

```sh
cd packages/ui && pnpm dlx shadcn-svelte@latest add <component>
```

Afterwards rewrite the generated `$lib/…` imports to relative paths
(`$lib/utils.js` → `../../../utils.js`, `$lib/components/ui/button/index.js` →
`../button/index.js`). The files are compiled inside the consuming app, where
`$lib` is _that app's_ lib — the alias exists in `tsconfig.json` only so the CLI
can place files.

The components stay under shadcn-svelte's upstream licence and carry no SPDX
header of ours (`scripts/check-spdx-headers.mjs` excludes `**/components/ui/**`).
