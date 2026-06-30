<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Snippet } from 'svelte';

  import BottomNav from './BottomNav.svelte';
  import Breadcrumbs from './Breadcrumbs.svelte';
  import Nav from './Nav.svelte';
  import PwaStatus from './PwaStatus.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<!-- pb-16 sm:pb-0: reserve space for the fixed mobile bottom nav -->
<div class="flex flex-col min-h-dvh pb-16 sm:pb-0">
  <PwaStatus />

  <header
    class="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center gap-x-5 px-4"
  >
    <a class="text-lg font-bold text-primary no-underline" href={resolve('/')}>selbstbehalt</a>
    <Nav />
  </header>

  <main class="pt-14 flex-1 w-full max-w-screen-xl mx-auto px-4 py-5 bg-background">
    <Breadcrumbs />
    {@render children()}
  </main>

  <footer class="border-t border-border bg-muted py-4 text-center text-sm text-muted-foreground">
    <p class="m-0">selbstbehalt · PKV Manager</p>
  </footer>

  <BottomNav />
</div>
