// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
//
// Display names for `contracts.type` (§5.5) — the one place the German labels
// for the three contract kinds live, so the contract list, the contract detail
// page and the edit dialog cannot drift apart.

import type { ContractType } from '../enums.js';

/** German display names for the contract kinds (`contractTypeValues`). */
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  vollversicherung: 'Vollversicherung',
  zusatztarif: 'Zusatztarif',
  beihilfe: 'Beihilfe',
};
