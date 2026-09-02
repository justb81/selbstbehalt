// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { destructiveOutlineClass } from './button-variants';

describe('destructiveOutlineClass', () => {
  it('tints border, text and hover with the destructive token', () => {
    expect(destructiveOutlineClass.split(' ')).toEqual([
      'border-destructive',
      'text-destructive',
      'hover:bg-destructive/10',
    ]);
  });
});
