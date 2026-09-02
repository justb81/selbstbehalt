// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from '@selbstbehalt/shared';

vi.mock('$lib/api', () => ({
  api: { contracts: { update: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number = 0,
    ) {
      super(message);
    }
  },
}));

import ContractEditDialog from './ContractEditDialog.svelte';
import { api } from '$lib/api';

const CONTRACT: Contract = {
  id: 'c-1',
  policyholder_id: 'p-1',
  insurer_name: 'Debeka',
  contract_number: 'V-4711',
  type: 'vollversicherung',
  start_date: '2020-01-01',
  end_date: null,
  notes: null,
  created_at: '2020-01-01T00:00:00.000Z',
};

function setup() {
  const onsaved = vi.fn();
  render(ContractEditDialog, { props: { contract: CONTRACT, onsaved } });
  return { onsaved };
}

describe('ContractEditDialog', () => {
  beforeEach(() => {
    vi.mocked(api.contracts.update).mockReset();
  });

  it('opens with the contract prefilled', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Vertrag bearbeiten' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Versicherungsgesellschaft/)).toHaveValue('Debeka');
    expect(screen.getByLabelText('Vertragsnummer')).toHaveValue('V-4711');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('saves the edited contract and reports the updated row', async () => {
    const user = userEvent.setup();
    const updated: Contract = { ...CONTRACT, insurer_name: 'Barmenia' };
    vi.mocked(api.contracts.update).mockResolvedValue(updated);
    const { onsaved } = setup();

    const insurer = screen.getByLabelText(/Versicherungsgesellschaft/);
    await user.clear(insurer);
    await user.type(insurer, 'Barmenia');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(onsaved).toHaveBeenCalledWith(updated);
    });
    expect(api.contracts.update).toHaveBeenCalledWith('c-1', {
      insurer_name: 'Barmenia',
      contract_number: 'V-4711',
      type: 'vollversicherung',
      start_date: '2020-01-01',
      end_date: null,
      notes: null,
    });
    // Saving closes the dialog.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('keeps the dialog open and shows the failure when saving fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.contracts.update).mockRejectedValue(new Error('Netzwerkfehler'));
    const { onsaved } = setup();

    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Netzwerkfehler')).toBeInTheDocument();
    expect(onsaved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
