<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  InvoicePagePreview (docs/architecture.md §6.1): the scanned page as the user sees it,
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

  Not every page has a canvas. A page read from a PDF's text layer carries exact
  text and no pixels by design (#278), and for those the list is the *whole*
  representation — an explanatory panel takes the canvas's place rather than
  leaving an empty frame that reads as a failed scan (#362).

  Privacy: the pixels live in memory for the duration of the review and are never
  persisted or uploaded (docs/architecture.md §2.2, §8.1). This component only draws
  what it is handed.
-->
<script lang="ts">
  import { quadBounds, type ScanPreview } from '../ocr/preview';
  import { Button } from './ui/button';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { cn } from '../utils';

  let {
    preview,
    activeLineIndex = null,
    onLineSelect,
    showRecognizedLines = true,
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
    /**
     * Whether to list the recognised lines below the page. Pass `false` where
     * recognition has not run yet (the pre-OCR quality warning): there a count of
     * zero reads as "nothing was found" when nothing has been attempted
     * (issue #362).
     */
    showRecognizedLines?: boolean;
    class?: string;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  /** Page the user is looking at; follows {@link activeLineIndex} when it moves. */
  let pageIndex = $state(0);

  const pageCount = $derived(preview.pages.length);
  const page = $derived(preview.pages[pageIndex] ?? null);
  /** Recognised lines that sit on the page currently shown. */
  const pageLines = $derived(preview.lines.filter((line) => line.pageIndex === pageIndex));
  /**
   * A text-layer page was read, not recognised — calling its lines "erkannt"
   * would credit OCR with work it did not do (and did not need to do).
   */
  const linesSummary = $derived(
    `${page?.kind === 'text' ? 'Gelesene' : 'Erkannte'} Textzeilen dieser Seite (${pageLines.length})`,
  );
  /**
   * The page label names the **document** page, not the index in this list: an
   * image page past `PREVIEW_MAX_PAGES` gets no entry, and a text-layer page has
   * no image, so counting entries claimed "Seite 1 von 1" for sheet 2 of 2
   * (issue #362).
   */
  const pageLabel = $derived(
    page ? `Seite ${page.documentPage} von ${preview.documentPageCount}` : '',
  );
  const previewAriaLabel = $derived(
    showRecognizedLines
      ? `Vorschau der gescannten Rechnung, ${pageLabel}, mit ${pageLines.length} erkannten Textzeilen`
      : `Aufnahme der Rechnung, ${pageLabel}`,
  );

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
    // A text-layer page has no pixels to paint (issue #362); the panel in the
    // markup explains that instead.
    if (!target || !current || current.kind !== 'image') return;

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
    if (!current || current.kind !== 'image') return '';
    const fromTop = Math.round((bounds.y / current.image.height) * 100);
    return `${fromTop} % von oben`;
  }
</script>

{#if pageCount > 0 && page}
  <div class={cn('flex flex-col gap-2', className)}>
    <!-- Buttons only where there is something to page through, but the label
    whenever the document has more than one sheet: a lone image page out of five
    would otherwise present itself as the only page. -->
    {#if pageCount > 1 || preview.documentPageCount > 1}
      <div
        class={cn('flex items-center gap-2', pageCount > 1 ? 'justify-between' : 'justify-center')}
      >
        {#if pageCount > 1}
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
        {/if}
        <span class="text-muted-foreground text-sm" aria-live="polite">{pageLabel}</span>
        {#if pageCount > 1}
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
        {/if}
      </div>
    {/if}

    {#if page.kind === 'image'}
      <!-- The name sits on the wrapper, not the canvas: a bare <canvas> is an
      unlabelled graphic to axe, but it also counts as an interactive element, so
      `role="img"` on it is itself invalid. The pixels carry nothing a screen
      reader can use — the recognised text is exposed by the list below — so the
      canvas is marked decorative and the wrapper is the labelled image. -->
      <div role="img" aria-label={previewAriaLabel}>
        <canvas
          bind:this={canvas}
          aria-hidden="true"
          class="bg-muted h-auto w-full max-w-full rounded-md border"
        ></canvas>
      </div>
    {:else}
      <!-- A text-layer page has no pixels on purpose (#278): rasterising it just
      to have something to show would cost the whole speed advantage of the path
      that produces the *better* result. So name the state instead of rendering
      the empty shell of a page image (#362). Deliberately not an <Alert>: that
      component hardcodes `role="alert"`, an assertive live region, and this is
      static explanatory copy that re-renders on every page turn. -->
      <div
        class="bg-muted/40 flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center"
      >
        <FileTextIcon class="text-muted-foreground size-6" />
        <p class="text-sm font-medium">Kein Seitenbild nötig</p>
        <p class="text-muted-foreground max-w-prose text-xs">
          Diese Seite enthält eine Textebene: der Text wurde direkt aus dem PDF gelesen, nicht per
          Bilderkennung geschätzt. Die gelesenen Zeilen stehen darunter.
        </p>
      </div>
    {/if}

    {#if pageCount < preview.documentPageCount}
      <p class="text-muted-foreground text-xs">
        Vorschau für {pageCount} von {preview.documentPageCount} Seiten gespeichert – erkannt wurden alle
        Seiten.
      </p>
    {/if}

    {#if showRecognizedLines}
      <details class="text-sm">
        <summary class="text-muted-foreground cursor-pointer">{linesSummary}</summary>
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
    {/if}
  </div>
{/if}
