<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoicePagePreview (docs/design.md §4.1): the scanned page as the user sees it,
  with every recognised text line outlined on top and the active line — the one
  behind the position row being reviewed — highlighted.

  This is what makes a misread checkable: instead of trusting "Ziffer 250,
  Steigerungsfaktor 2,3", the user can look at the line it came from.

  The outlines are drawn *onto the canvas* rather than as positioned elements.
  Two reasons: the project's UI standard forbids custom CSS and `<style>` blocks
  (a box per line would need inline pixel geometry), and a dense invoice page can
  carry a hundred lines — a hundred extra DOM nodes that only ever get painted.

  A canvas conveys nothing to a screen reader, so the recognised lines are *also*
  rendered as a real list below it. That list is the accessible representation,
  not a fallback: it is keyboard-reachable and announces each line's text.

  Privacy: the pixels live in memory for the duration of the review and are never
  persisted or uploaded (docs/design.md §1.3, §8.2). This component only draws
  what it is handed.
-->
<script lang="ts">
  import { quadBounds, type ScanPreview } from '../ocr/preview';
  import { Button } from './ui/button';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { cn } from '../utils';

  let {
    preview,
    activeLineIndex = null,
    onLineSelect,
    class: className,
  }: {
    /** Pages + recognised lines to draw (from `buildScanPreview`). */
    preview: ScanPreview;
    /**
     * Scan-line index to highlight (`ReviewPosition.lineIndex`), or `null` for
     * none. The page holding it is selected automatically.
     */
    activeLineIndex?: number | null;
    /** Called when the user picks a line from the accessible line list. */
    onLineSelect?: (sourceLineIndex: number) => void;
    class?: string;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  /** Page the user is looking at; follows {@link activeLineIndex} when it moves. */
  let pageIndex = $state(0);

  const pageCount = $derived(preview.pages.length);
  const page = $derived(preview.pages[pageIndex] ?? null);
  /** Recognised lines that sit on the page currently shown. */
  const pageLines = $derived(preview.lines.filter((line) => line.pageIndex === pageIndex));

  // Follow the active line onto its own page, so selecting a position row on
  // page 2 doesn't silently highlight nothing while page 1 is displayed.
  $effect(() => {
    if (activeLineIndex === null) return;
    const owner = preview.lines.find((line) => line.sourceLineIndex === activeLineIndex);
    if (owner && owner.pageIndex !== pageIndex) pageIndex = owner.pageIndex;
  });

  // Clamp when a shorter preview replaces a longer one.
  $effect(() => {
    if (pageIndex >= pageCount) pageIndex = 0;
  });

  /**
   * Repaints the page and its outlines. Runs whenever the page, the lines or the
   * active line change — cheap enough to redo wholesale (one `putImageData` plus
   * a stroke per line) that tracking dirty regions would be false economy.
   */
  $effect(() => {
    const target = canvas;
    const current = page;
    // Read the reactive dependencies unconditionally so the effect re-runs.
    const lines = pageLines;
    const active = activeLineIndex;
    if (!target || !current) return;

    target.width = current.image.width;
    target.height = current.image.height;
    const context = target.getContext('2d');
    if (!context) return;

    context.putImageData(current.image, 0, 0);

    // Scale the stroke with the page so outlines stay visible on a large scan
    // and don't swallow the text on a small one.
    const unit = Math.max(1, Math.round(current.image.width / 500));
    for (const line of lines) {
      if (line.points.length === 0) continue;
      const isActive = active !== null && line.sourceLineIndex === active;
      context.beginPath();
      const [first, ...rest] = line.points;
      context.moveTo(first![0], first![1]);
      for (const [x, y] of rest) context.lineTo(x, y);
      context.closePath();
      if (isActive) {
        // A translucent fill as well as a heavier stroke: on a dense page an
        // outline alone is hard to pick out among its neighbours.
        context.fillStyle = 'rgba(37, 99, 235, 0.25)';
        context.fill();
        context.lineWidth = unit * 2;
        context.strokeStyle = 'rgba(37, 99, 235, 0.95)';
      } else {
        context.lineWidth = unit;
        context.strokeStyle = 'rgba(37, 99, 235, 0.35)';
      }
      context.stroke();
    }
  });

  /** Human-readable position of a line on the page, for the accessible list. */
  function lineLabel(points: Array<[number, number]>): string {
    const bounds = quadBounds(points);
    if (bounds.width === 0 && bounds.height === 0) return '';
    const current = page;
    if (!current) return '';
    const fromTop = Math.round((bounds.y / current.image.height) * 100);
    return `${fromTop} % von oben`;
  }
</script>

{#if pageCount > 0 && page}
  <div class={cn('flex flex-col gap-2', className)}>
    {#if pageCount > 1}
      <div class="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onclick={() => (pageIndex -= 1)}
        >
          <ChevronLeftIcon class="size-4" />
          <span class="sr-only">Vorherige Seite</span>
        </Button>
        <span class="text-muted-foreground text-sm" aria-live="polite">
          Seite {pageIndex + 1} von {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= pageCount - 1}
          onclick={() => (pageIndex += 1)}
        >
          <ChevronRightIcon class="size-4" />
          <span class="sr-only">Nächste Seite</span>
        </Button>
      </div>
    {/if}

    <!-- The name sits on the wrapper, not the canvas: a bare <canvas> is an
    unlabelled graphic to axe, but it also counts as an interactive element, so
    `role="img"` on it is itself invalid. The pixels carry nothing a screen
    reader can use — the recognised text is exposed by the list below — so the
    canvas is marked decorative and the wrapper is the labelled image. -->
    <div
      role="img"
      aria-label={`Vorschau der gescannten Rechnung, Seite ${pageIndex + 1} von ${pageCount}, mit ${pageLines.length} erkannten Textzeilen`}
    >
      <canvas
        bind:this={canvas}
        aria-hidden="true"
        class="bg-muted h-auto w-full max-w-full rounded-md border"
      ></canvas>
    </div>

    <details class="text-sm">
      <summary class="text-muted-foreground cursor-pointer">
        Erkannte Textzeilen dieser Seite ({pageLines.length})
      </summary>
      <ul class="mt-2 flex flex-col gap-1">
        {#each pageLines as line (line.sourceLineIndex)}
          <li>
            <button
              type="button"
              onclick={() => onLineSelect?.(line.sourceLineIndex)}
              aria-current={activeLineIndex === line.sourceLineIndex ? 'true' : undefined}
              class={cn(
                'w-full rounded px-2 py-1 text-left font-mono text-xs',
                activeLineIndex === line.sourceLineIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {line.text || '(leer)'}
              <span class="text-muted-foreground ml-1 font-sans">{lineLabel(line.points)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </details>
  </div>
{/if}
