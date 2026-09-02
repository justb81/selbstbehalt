// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncludedBenefits } from '@selbstbehalt/shared';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast }));

import IncludedBenefitsEditor from './IncludedBenefitsEditor.svelte';

function setup(value: IncludedBenefits | null = null) {
  const onchange = vi.fn();
  const rendered = render(IncludedBenefitsEditor, { props: { value, onchange } });
  return { onchange, component: rendered.component };
}

/** The last `(value, valid)` pair the editor reported. */
function lastChange(onchange: ReturnType<typeof vi.fn>) {
  return onchange.mock.calls.at(-1) as [IncludedBenefits | null, boolean];
}

const KFO: IncludedBenefits = {
  benefits: [
    {
      category: 'kieferorthopaedie',
      tiers: [
        { up_to: 1000, pct: 80 },
        { up_to: null, pct: 50 },
      ],
    },
  ],
};

describe('IncludedBenefitsEditor', () => {
  beforeEach(() => {
    toast.mockClear();
  });

  it('starts collapsed for an insured person without a configuration', () => {
    const { onchange } = setup(null);
    expect(
      screen.getByRole('checkbox', { name: 'Enthaltene Leistungen konfigurieren' }),
    ).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Leistungsbereich hinzufügen/ })).toBeNull();
    expect(lastChange(onchange)).toEqual([null, true]);
  });

  it('prefills the existing configuration and reports it back unchanged', () => {
    const { onchange } = setup(KFO);
    expect(
      screen.getByRole('checkbox', { name: 'Enthaltene Leistungen konfigurieren' }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Leistungsbereich' })).toHaveTextContent(
      'Kieferorthopädie',
    );
    expect(lastChange(onchange)).toEqual([KFO, true]);
  });

  it('adds a benefit area once the configuration is switched on', async () => {
    const user = userEvent.setup();
    const { onchange } = setup(null);
    await user.click(screen.getByRole('checkbox', { name: 'Enthaltene Leistungen konfigurieren' }));
    expect(screen.getByText('Noch kein Leistungsbereich hinzugefügt.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Leistungsbereich hinzufügen/ }));
    expect(lastChange(onchange)).toEqual([{ benefits: [{ category: 'ambulant' }] }, true]);
  });

  it('flags a Zod issue on the field its path points at and focuses it', async () => {
    const user = userEvent.setup();
    const { onchange, component } = setup(KFO);

    const beihilfe = screen.getByRole('spinbutton', { name: 'Beihilfe-Satz (%)' });
    await user.type(beihilfe, '150');

    expect(beihilfe).toHaveAttribute('aria-invalid', 'true');
    const message = screen.getByText('Prozentsatz darf 100 nicht überschreiten');
    expect(beihilfe).toHaveAttribute('aria-describedby', message.id);
    // An invalid configuration is reported as "no value, not valid".
    expect(lastChange(onchange)).toEqual([null, false]);

    beihilfe.blur();
    expect(component.focusFirstInvalid()).toBe(true);
    expect(document.activeElement).toBe(beihilfe);
  });

  it('flags a non-ascending Erstattungsstaffel on the offending row', async () => {
    const user = userEvent.setup();
    const { onchange } = setup(KFO);

    // Insert a second finite tier, then push it below its predecessor.
    await user.click(screen.getByRole('button', { name: /Stufe hinzufügen/ }));
    const upTo = screen.getAllByRole('spinbutton', { name: 'Bis (€)' });
    expect(upTo).toHaveLength(2);
    await user.clear(upTo[1]!);
    await user.type(upTo[1]!, '500');

    expect(upTo[1]).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('tiers müssen aufsteigend nach up_to sortiert sein'),
    ).toBeInTheDocument();
    expect(lastChange(onchange)[1]).toBe(false);
  });

  it('restores a whole removed Leistungsbereich from the undo toast', async () => {
    const user = userEvent.setup();
    const { onchange } = setup(KFO);

    await user.click(
      screen.getByRole('button', { name: 'Leistungsbereich Kieferorthopädie entfernen' }),
    );
    expect(lastChange(onchange)).toEqual([null, true]);

    const [message, options] = toast.mock.calls.at(-1) as [
      string,
      { action: { onClick: () => void } },
    ];
    expect(message).toBe('Leistungsbereich entfernt');
    options.action.onClick();
    await Promise.resolve();
    expect(lastChange(onchange)).toEqual([KFO, true]);
  });

  it('removes a Staffel row and restores it from the undo toast', async () => {
    const user = userEvent.setup();
    const { onchange } = setup(KFO);

    await user.click(screen.getByRole('checkbox', { name: 'Aufbaujahre (Zahnstaffel)' }));
    await user.click(screen.getByRole('button', { name: /Jahr hinzufügen/ }));
    expect(lastChange(onchange)[0]?.benefits[0]?.annual_staffel).toEqual([
      { policy_year: 1, cumulative_cap: null },
    ]);

    await user.click(screen.getByRole('button', { name: 'Jahr entfernen' }));
    expect(lastChange(onchange)[0]?.benefits[0]?.annual_staffel).toBeUndefined();

    const [, options] = toast.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];
    options.action.onClick();
    await Promise.resolve();
    expect(lastChange(onchange)[0]?.benefits[0]?.annual_staffel).toEqual([
      { policy_year: 1, cumulative_cap: null },
    ]);
  });
});
