// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { refundStatus } from './position-refund';

describe('refundStatus', () => {
  it('returns tone "none" with no difference when the refund is unknown', () => {
    expect(refundStatus(100, null)).toEqual({ tone: 'none', className: '', difference: null });
    expect(refundStatus(100, undefined)).toEqual({
      tone: 'none',
      className: '',
      difference: null,
    });
  });

  it('returns tone "rejected" when the refund is exactly 0', () => {
    expect(refundStatus(80, 0)).toEqual({
      tone: 'rejected',
      className: 'text-destructive',
      difference: -80,
    });
  });

  it('returns tone "full" (no difference) when the refund covers the charged amount', () => {
    expect(refundStatus(100, 100)).toEqual({
      tone: 'full',
      className: 'text-success',
      difference: null,
    });
    expect(refundStatus(100, 120)).toEqual({
      tone: 'full',
      className: 'text-success',
      difference: null,
    });
  });

  it('returns tone "partial" with the shortfall when the refund is below the charged amount', () => {
    expect(refundStatus(100, 60)).toEqual({
      tone: 'partial',
      className: 'text-warning',
      difference: -40,
    });
  });
});
