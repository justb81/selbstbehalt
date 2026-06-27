// SPDX-License-Identifier: Apache-2.0
import { buildHealthResponse } from './lib/health.js';

// Placeholder entrypoint until the Hono server lands (#9). It exists so the
// `build` step produces a real artifact and `dev` has something to run.
console.log(JSON.stringify(buildHealthResponse()));
