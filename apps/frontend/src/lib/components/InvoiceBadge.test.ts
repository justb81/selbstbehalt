// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import InvoiceBadge from './InvoiceBadge.svelte';

describe('InvoiceBadge', () => {
  it.each([
    ['neu', 'Neu'],
    ['geprüft', 'Geprüft'],
    ['offen', 'Offen'],
    ['bezahlt', 'Bezahlt'],
    ['nicht_eingereicht', 'Nicht eingereicht'],
    ['eingereicht', 'Eingereicht'],
    ['erstattet', 'Erstattet'],
    // Display-only, never persisted as an event value.
    ['nicht_erstattungsfaehig', 'Nicht erstattungsfähig'],
  ] as const)('renders the German label for status "%s"', (status, label) => {
    render(InvoiceBadge, { props: { status } });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
