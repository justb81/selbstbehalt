<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { base } from '$app/paths';
  import { configureOcr, resolveOcrAssets } from '@selbstbehalt/medic-invoice-check';
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

  <header class="border-b border-border bg-background/95 backdrop-blur px-4 py-3">
    <span class="text-lg font-bold text-primary">GOÄ-Wächter</span>
  </header>

  <main id="main-content" tabindex="-1" class="flex-1 w-full focus:outline-none">
    <div class="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <PwaStatus />
      {@render children()}
    </div>
  </main>

  <footer class="border-t border-border bg-muted py-4 text-center text-sm text-muted-foreground">
    <p class="m-0">GOÄ-Wächter · eine Demo von selbstbehalt (PKV Manager)</p>
  </footer>
</div>
