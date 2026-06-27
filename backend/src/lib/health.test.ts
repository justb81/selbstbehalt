// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { buildHealthResponse } from './health';

describe('buildHealthResponse', () => {
  it('reports an ok status with the default service name', () => {
    expect(buildHealthResponse()).toEqual({ status: 'ok', service: 'selbstbehalt-backend' });
  });

  it('allows overriding the service name', () => {
    expect(buildHealthResponse('worker')).toEqual({ status: 'ok', service: 'worker' });
  });
});
