<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import type { Snippet } from 'svelte';

  import Nav from './Nav.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="app-shell">
  <header class="app-header">
    <a class="brand" href={resolve('/')}>selbstbehalt</a>
    <Nav />
  </header>

  <main class="app-main">
    {@render children()}
  </main>

  <footer class="app-footer">
    <p>selbstbehalt · PKV Manager</p>
  </footer>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
  }

  .app-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-5);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
  }

  .brand {
    font-size: var(--font-size-lg);
    font-weight: 700;
    color: var(--color-primary);
    text-decoration: none;
  }

  .app-main {
    flex: 1;
    width: 100%;
    max-width: var(--layout-max-width);
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
  }

  .app-footer {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .app-footer p {
    margin: 0;
  }
</style>
