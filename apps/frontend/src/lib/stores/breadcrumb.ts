// SPDX-License-Identifier: Apache-2.0
//
// Ephemeral UI state: the human-readable name of the entity a detail page is
// currently showing, so the global Breadcrumbs component can render the real
// object name (e.g. "NK 2 Max") instead of a generic placeholder ("Versicherte
// Person"). Detail pages set this once their data has loaded; it is keyed by the
// route's `[id]` segment so a stale label from the previous page never leaks
// onto the next one before that page has loaded its own entity.

import { writable } from 'svelte/store';

export interface BreadcrumbEntity {
  /** The `[id]` route parameter this label belongs to. */
  id: string;
  /** The object's display name, e.g. the provider, insurer, person or tariff. */
  label: string;
}

/** The entity label for the current detail route, or null while none is set. */
export const breadcrumbEntity = writable<BreadcrumbEntity | null>(null);

/** Set the breadcrumb object label for the given `[id]` route parameter. */
export function setBreadcrumbEntity(id: string, label: string): void {
  breadcrumbEntity.set({ id, label });
}
