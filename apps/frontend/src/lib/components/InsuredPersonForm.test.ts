// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsuredPerson, Person } from '@selbstbehalt/shared';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast }));

vi.mock('$lib/api', () => ({
  api: { insured: { create: vi.fn(), update: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number = 0,
    ) {
      super(message);
    }
  },
}));

import InsuredPersonForm from './InsuredPersonForm.svelte';
import { api } from '$lib/api';

const PERSONS: Person[] = [
  { id: 'p-1', name: 'Anna Muster', birth_date: '1985-04-12', created_at: '2020-01-01' },
  { id: 'p-2', name: 'Ben Muster', birth_date: null, created_at: '2020-01-01' },
];

const INSURED: InsuredPerson = {
  id: 'ip-1',
  contract_id: 'c-1',
  person_id: 'p-1',
  person_name: 'Anna Muster',
  kvnr: 'A123456789',
  tariff_name: 'NK4',
  monthly_premium: 480,
  self_retention: 600,
  bre_structure: {
    type: 'staffel',
    levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
    current_streak_start: '2024-01-01',
  },
  included_benefits: null,
  start_date: '2020-01-01',
  end_date: null,
  notes: null,
  created_at: '2020-01-01T00:00:00.000Z',
};

function setup(insured: InsuredPerson | null = null) {
  const onsaved = vi.fn();
  const oncancel = vi.fn();
  render(InsuredPersonForm, {
    props: { contractId: 'c-1', insured, persons: PERSONS, onsaved, oncancel },
  });
  return { onsaved, oncancel };
}

describe('InsuredPersonForm', () => {
  beforeEach(() => {
    vi.mocked(api.insured.create).mockReset();
    vi.mocked(api.insured.update).mockReset();
    toast.mockClear();
  });

  it('labels every field and focuses the person picker on mount', async () => {
    setup();
    expect(screen.getByText('Neue versicherte Person')).toBeInTheDocument();
    expect(screen.getByLabelText('KVNR')).toBeInTheDocument();
    expect(screen.getByLabelText('Tarifname')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Monatsbeitrag/)).toBeInTheDocument();
    expect(screen.getByLabelText('Jährlicher Selbstbehalt (€)')).toBeInTheDocument();
    expect(screen.getByLabelText('Notizen')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Person/ }));
    });
  });

  it('refuses to save without a person', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Bitte eine Person auswählen.')).toBeInTheDocument();
    expect(api.insured.create).not.toHaveBeenCalled();
  });

  it('refuses to save without a Monatsbeitrag', async () => {
    const user = userEvent.setup();
    setup({ ...INSURED, monthly_premium: 0 });
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(
      await screen.findByText('Bitte einen Monatsbeitrag (> 0) eingeben.'),
    ).toBeInTheDocument();
    expect(api.insured.update).not.toHaveBeenCalled();
  });

  it('prefills an existing insured person, BRE ladder included, and updates it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.insured.update).mockResolvedValue(INSURED);
    const { onsaved } = setup(INSURED);

    expect(screen.getByLabelText('KVNR')).toHaveValue('A123456789');
    expect(screen.getByLabelText(/^Monatsbeitrag/)).toHaveValue(480);
    expect(screen.getByRole('checkbox', { name: 'BRE-Staffel konfigurieren' })).toBeChecked();
    expect(screen.getByLabelText('Leistungsfreiheit begann am')).toHaveValue('2024-01-01');
    expect(screen.getByRole('spinbutton', { name: 'Leistungsfreie Jahre' })).toHaveValue(1);

    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(onsaved).toHaveBeenCalledWith(INSURED);
    });
    expect(api.insured.update).toHaveBeenCalledWith(
      'ip-1',
      expect.objectContaining({
        person_id: 'p-1',
        monthly_premium: 480,
        self_retention: 600,
        bre_structure: {
          type: 'staffel',
          levels: [{ claim_free_years: 1, bre_years: 1, pct_of_premium: 100 }],
          current_streak_start: '2024-01-01',
        },
        included_benefits: null,
      }),
    );
  });

  it('adds a BRE step and drops the BRE structure when the box is unchecked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.insured.update).mockResolvedValue(INSURED);
    setup(INSURED);

    await user.click(screen.getByRole('button', { name: /Stufe hinzufügen/ }));
    expect(screen.getAllByRole('spinbutton', { name: 'Leistungsfreie Jahre' })).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: 'BRE-Staffel konfigurieren' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(api.insured.update).toHaveBeenCalledWith(
        'ip-1',
        expect.objectContaining({ bre_structure: null }),
      );
    });
  });

  it('blocks the submit while the Leistungskonfiguration is invalid', async () => {
    const user = userEvent.setup();
    setup({
      ...INSURED,
      bre_structure: null,
      included_benefits: {
        benefits: [
          {
            category: 'zahnersatz',
            tiers: [
              { up_to: 1000, pct: 80 },
              { up_to: null, pct: 50 },
            ],
          },
        ],
      },
    });

    // Break the Erstattungsstaffel: a second step below its predecessor. (A
    // range violation like a 150 % Beihilfe-Satz would already be caught by the
    // browser's own constraint validation, which never reaches `save()`.)
    await user.click(screen.getByRole('button', { name: /Stufe hinzufügen/ }));
    const upTo = screen.getAllByRole('spinbutton', { name: 'Bis (€)' });
    await user.clear(upTo[1]!);
    await user.type(upTo[1]!, '500');
    upTo[1]!.blur();

    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(
      await screen.findByText(
        'Leistungskonfiguration ist ungültig. Bitte die markierten Felder prüfen.',
      ),
    ).toBeInTheDocument();
    expect(api.insured.update).not.toHaveBeenCalled();
    // The offending field takes focus.
    expect(document.activeElement).toBe(upTo[1]);
  });

  it('surfaces a failing save without losing the form', async () => {
    const user = userEvent.setup();
    vi.mocked(api.insured.update).mockRejectedValue(new Error('Server nicht erreichbar'));
    const { onsaved } = setup(INSURED);

    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Server nicht erreichbar')).toBeInTheDocument();
    expect(onsaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('KVNR')).toHaveValue('A123456789');
  });

  it('cancels without saving', async () => {
    const user = userEvent.setup();
    const { oncancel } = setup(INSURED);
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(api.insured.update).not.toHaveBeenCalled();
  });
});
