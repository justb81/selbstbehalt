<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Generic repeater (issue #465): a list of same-shaped rows the user can extend
  and shrink, rendered as a real shadcn `Table` instead of a fixed-width
  `grid-cols-[…rem…]` pseudo-table. That buys three things the div variant never
  had: `scope="col"` headers an assistive technology can associate with the
  cells, a stable `id` per header so a bare cell input can point at it via
  `aria-labelledby`, and horizontal scrolling inside the table container (the
  vendored `Table` wraps itself in `overflow-x-auto`) so a narrow viewport never
  scrolls the whole page.

  Removing a row is instant but reversible: when the caller passes `onRestore`,
  the row is put back from an undo toast (`svelte-sonner`, mounted once in
  `AppShell`) instead of being guarded by a confirmation dialog.
-->
<script lang="ts" module>
  /** One column of a {@link RepeaterTable}. `key` also keys the header `id`. */
  export type RepeaterColumn = {
    key: string;
    label: string;
    align?: 'left' | 'center' | 'right';
    /** Extra Tailwind classes for both the header and the body cells. */
    class?: string;
  };
</script>

<script lang="ts" generics="TRow">
  import type { Snippet } from 'svelte';
  import { toast } from 'svelte-sonner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { Button } from '@selbstbehalt/ui/button';
  import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';

  type Props = {
    /** Screen-reader-only caption naming what the rows are. */
    caption: string;
    columns: RepeaterColumn[];
    rows: TRow[];
    /** Prefix for the generated header `id`s — unique per table on the page. */
    idPrefix: string;
    /** Label of the "add row" action, e.g. `'Stufe hinzufügen'`. */
    addLabel: string;
    onAdd: () => void;
    onRemove: (index: number) => void;
    /**
     * Put a removed row back at `index`. Passing it turns row removal into an
     * undoable action (toast with a "Rückgängig" button).
     */
    onRestore?: (index: number, row: TRow) => void;
    /** `aria-label` of a row's remove button. */
    removeLabel?: (row: TRow, index: number) => string;
    /** Rows for which removal is disabled (e.g. a mandatory trailing tier). */
    canRemove?: (row: TRow, index: number) => boolean;
    disabled?: boolean;
    /** Renders one cell. `headerId` is the `id` of the column's `<th>`. */
    cell: Snippet<
      [{ row: TRow; index: number; column: RepeaterColumn; headerId: string; disabled: boolean }]
    >;
  };

  let {
    caption,
    columns,
    rows,
    idPrefix,
    addLabel,
    onAdd,
    onRemove,
    onRestore,
    removeLabel = () => 'Zeile entfernen',
    canRemove = () => true,
    disabled = false,
    cell,
  }: Props = $props();

  const ALIGN: Record<NonNullable<RepeaterColumn['align']>, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  function headerId(column: RepeaterColumn): string {
    return `${idPrefix}-${column.key}`;
  }

  function remove(index: number) {
    const row = rows[index] as TRow;
    onRemove(index);
    if (onRestore) {
      toast('Zeile entfernt', {
        action: { label: 'Rückgängig', onClick: () => onRestore(index, row) },
      });
    }
  }
</script>

<div class="space-y-2">
  <Table>
    <TableCaption class="sr-only">{caption}</TableCaption>
    <TableHeader>
      <TableRow>
        {#each columns as column (column.key)}
          <TableHead
            scope="col"
            id={headerId(column)}
            class="{ALIGN[column.align ?? 'left']} {column.class ?? ''}"
          >
            {column.label}
          </TableHead>
        {/each}
        <TableHead scope="col" class="w-12">
          <span class="sr-only">Aktionen</span>
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {#each rows as row, index (index)}
        <TableRow>
          {#each columns as column (column.key)}
            <TableCell class="{ALIGN[column.align ?? 'left']} {column.class ?? ''} align-top">
              {@render cell({ row, index, column, headerId: headerId(column), disabled })}
            </TableCell>
          {/each}
          <TableCell class="w-12 align-top">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={removeLabel(row, index)}
              disabled={disabled || !canRemove(row, index)}
              onclick={() => remove(index)}
            >
              <Trash2Icon class="size-4" />
            </Button>
          </TableCell>
        </TableRow>
      {/each}
    </TableBody>
  </Table>
  <Button type="button" variant="link" class="h-auto px-0" {disabled} onclick={onAdd}>
    <PlusIcon class="size-4" />
    {addLabel}
  </Button>
</div>
