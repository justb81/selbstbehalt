// SPDX-FileCopyrightText: 2026 Bastian Rang and contributors
// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, type ComponentProps } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast }));

import RepeaterTable, { type RepeaterColumn } from './RepeaterTable.svelte';

type Row = { pct: number };

// `render()` cannot infer the component's `TRow` generic, so the props type
// resolves with `row: unknown` — the cell snippet casts it back.
type Props = ComponentProps<typeof RepeaterTable>;
type CellArgs = Parameters<Props['cell']>[0];

const COLUMNS: RepeaterColumn[] = [
  { key: 'pct', label: 'Erstattung (%)' },
  { key: 'note', label: 'Hinweis' },
];

/** Renders the `pct` column as an input labelled by its `<th>`. */
const cell = createRawSnippet<[CellArgs]>((arg) => ({
  render: () =>
    `<input aria-labelledby="${arg().headerId}" data-column="${arg().column.key}" value="${(arg().row as Row).pct}" />`,
}));

function setup(overrides: Partial<Props> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const onRestore = vi.fn();
  const props: Props = {
    caption: 'Stufen der Erstattung',
    columns: COLUMNS,
    rows: [{ pct: 80 }, { pct: 100 }],
    idPrefix: 'tier',
    addLabel: 'Stufe hinzufügen',
    onAdd,
    onRemove,
    onRestore,
    cell,
    ...overrides,
  };
  render(RepeaterTable, { props });
  return { onAdd, onRemove, onRestore };
}

describe('RepeaterTable', () => {
  beforeEach(() => {
    toast.mockClear();
  });

  it('renders column headers with scope="col" and a screen-reader caption', () => {
    setup();
    const headers = screen.getAllByRole('columnheader');
    // Two data columns plus the actions column.
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      expect(header).toHaveAttribute('scope', 'col');
    }
    expect(screen.getByText('Stufen der Erstattung')).toHaveClass('sr-only');
    expect(screen.getByText('Aktionen')).toHaveClass('sr-only');
  });

  it('gives each header a stable id the cells point at via aria-labelledby', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: 'Erstattung (%)' })).toHaveAttribute(
      'id',
      'tier-pct',
    );
    const inputs = screen.getAllByRole('textbox', { name: 'Erstattung (%)' });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute('aria-labelledby', 'tier-pct');
  });

  it('adds a row through the add action', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    await user.click(screen.getByRole('button', { name: /Stufe hinzufügen/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('removes a row and offers an undo toast that puts it back', async () => {
    const user = userEvent.setup();
    const { onRemove, onRestore } = setup();
    await user.click(screen.getAllByRole('button', { name: 'Zeile entfernen' })[1]!);
    expect(onRemove).toHaveBeenCalledWith(1);

    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = toast.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe('Zeile entfernt');
    expect(options.action.label).toBe('Rückgängig');
    options.action.onClick();
    expect(onRestore).toHaveBeenCalledWith(1, { pct: 100 });
  });

  it('removes without an undo toast when no onRestore is given', async () => {
    const user = userEvent.setup();
    const { onRemove } = setup({ onRestore: undefined });
    await user.click(screen.getAllByRole('button', { name: 'Zeile entfernen' })[0]!);
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it('disables the remove button for rows the caller protects', () => {
    setup({
      canRemove: (_row, index) => index === 0,
      removeLabel: (_row, index) => `Stufe ${index + 1} entfernen`,
    });
    expect(screen.getByRole('button', { name: 'Stufe 1 entfernen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stufe 2 entfernen' })).toBeDisabled();
  });
});
