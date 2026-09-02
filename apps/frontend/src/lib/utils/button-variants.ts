// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tailwind class add-ons for the vendored shadcn `Button` variants. The
// vendored component under `$lib/components/ui/button` is maintained by the
// shadcn-svelte CLI and must not be patched (CLAUDE.md / issue #438), so a
// recurring look that shadcn has no variant for lives here instead of being
// copy-pasted per call site.

/**
 * A destructive action rendered as an outline button: `variant="outline"` plus
 * these classes. Used for the "Löschen" buttons on the contract and person
 * detail pages, where a filled `variant="destructive"` would shout too loudly
 * next to the neutral page actions.
 */
export const destructiveOutlineClass =
  'border-destructive text-destructive hover:bg-destructive/10';
