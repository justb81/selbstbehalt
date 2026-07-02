// SPDX-License-Identifier: Apache-2.0
//
// Structured configuration sourced from environment variables (§7). Parsing is
// centralised here so the rest of the app receives a validated, typed `Config`
// and never touches `process.env` directly.

import { z } from 'zod';

const configSchema = z.object({
  /** HTTP port the Hono server listens on (§2.1: 8080). */
  PORT: z.coerce.number().int().positive().default(8080),

  /**
   * Path to the SQLite database file. `:memory:` is honoured for ephemeral
   * runs (and tests). Defaults to a local dev path; Docker overrides it.
   */
  DATABASE_PATH: z.string().min(1).default('data/db/pkv.sqlite'),

  /**
   * Optional `X-API-Key` shared secret. When empty/unset the API-key check is
   * disabled (pure home-network operation behind a reverse proxy — §7.2).
   */
  API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),

  /**
   * Comma-separated list of allowed CORS origins, or `*` for any. Defaults to
   * `*` since the server is meant to run on a trusted home network.
   */
  CORS_ORIGINS: z.string().default('*'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface Config {
  port: number;
  databasePath: string;
  apiKey: string | undefined;
  corsOrigins: string[] | '*';
  nodeEnv: 'development' | 'test' | 'production';
}

/**
 * Parse and validate configuration from an environment-like record.
 * Throws a descriptive error if any value is malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid backend configuration:\n${issues}`);
  }

  const { CORS_ORIGINS } = parsed.data;
  const corsOrigins =
    CORS_ORIGINS.trim() === '*'
      ? '*'
      : CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean);

  return {
    port: parsed.data.PORT,
    databasePath: parsed.data.DATABASE_PATH,
    apiKey: parsed.data.API_KEY,
    corsOrigins,
    nodeEnv: parsed.data.NODE_ENV,
  };
}
