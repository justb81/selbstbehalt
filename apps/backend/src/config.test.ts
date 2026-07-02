// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies sensible defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.databasePath).toBe('data/db/pkv.sqlite');
    expect(config.apiKey).toBeUndefined();
    expect(config.corsOrigins).toBe('*');
    expect(config.nodeEnv).toBe('development');
  });

  it('parses and coerces overrides', () => {
    const config = loadConfig({
      PORT: '9090',
      DATABASE_PATH: ':memory:',
      API_KEY: 'secret',
      CORS_ORIGINS: 'http://a.test, http://b.test',
      NODE_ENV: 'production',
    });
    expect(config.port).toBe(9090);
    expect(config.databasePath).toBe(':memory:');
    expect(config.apiKey).toBe('secret');
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(config.nodeEnv).toBe('production');
  });

  it('treats a blank API_KEY as disabled', () => {
    expect(loadConfig({ API_KEY: '   ' }).apiKey).toBeUndefined();
  });

  it('throws on an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-number' })).toThrow(/Invalid backend configuration/);
  });

  it('throws on an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid backend configuration/);
  });
});
