// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// @selbstbehalt/ui — the shadcn-svelte primitives shared by apps/frontend, the
// GOÄ-Wächter demo and @selbstbehalt/medic-invoice-check (issue #438). Each
// component folder is its own subpath export (`@selbstbehalt/ui/button`,
// `@selbstbehalt/ui/card`, …) so consumers import exactly what they use, the
// same way the shadcn-svelte CLI lays them out; this root only carries the
// class helper.
export { cn } from './utils.js';
export type {
  WithElementRef,
  WithoutChild,
  WithoutChildren,
  WithoutChildrenOrChild,
} from './utils.js';
