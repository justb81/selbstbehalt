// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { defineEnvVars } from '@sveltejs/kit/env';

// Baked into the bundle at build time (see docs/self-hosting.md); empty/unset
// means same-origin, handled by `envApiBaseUrl()` in #lib/config.
export const variables = defineEnvVars({
  PUBLIC_API_URL: { public: true, static: true, schema: (value) => value?.trim() || undefined },
});
