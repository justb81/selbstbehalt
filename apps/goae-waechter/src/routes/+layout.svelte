<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { base } from '$app/paths';
  import { configureOcr, resolveOcrAssets } from '@selbstbehalt/medic-invoice-check';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import LockIcon from '@lucide/svelte/icons/lock';
  import PwaStatus from '$lib/components/PwaStatus.svelte';
  import '../app.css';

  // GitHub Pages serves the demo under /<repo>/ (issue #171); point the
  // on-device OCR assets at the base-prefixed models/** paths so the worker
  // fetches them from the right subpath. At the domain root `base` is '' and
  // this resolves to the same defaults apps/frontend uses. Runs once (the
  // layout mounts once) and before any scan spins up the OCR worker.
  configureOcr(resolveOcrAssets(base));

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col min-h-dvh">
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:no-underline"
  >
    Zum Inhalt springen
  </a>

  <header
    class="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur supports-backdrop-filter:bg-card/70 px-4 py-3 sm:px-6"
  >
    <div class="mx-auto flex max-w-3xl items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <ShieldCheckIcon class="size-4.5" />
        </span>
        <span class="text-lg font-bold tracking-tight text-foreground">GOÄ-Wächter</span>
      </div>
      <span
        class="hidden items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground sm:inline-flex"
      >
        <LockIcon class="size-3.5 text-primary" />
        100&nbsp;% lokal
      </span>
    </div>
  </header>

  <main id="main-content" tabindex="-1" class="flex-1 w-full focus:outline-none">
    <div class="mx-auto max-w-3xl px-4 py-8 space-y-6 sm:px-6">
      <PwaStatus />
      {@render children()}
    </div>
  </main>

  <footer class="border-t border-border py-6 text-center text-sm text-muted-foreground">
    <p class="m-0">GOÄ-Wächter · eine Demo von selbstbehalt (PKV Manager)</p>
  </footer>
</div>
