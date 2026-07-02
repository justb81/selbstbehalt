<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import PwaStatus from '$lib/components/PwaStatus.svelte';
  import '../app.css';

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
