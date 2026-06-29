<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  PWA status surface (issue #27): the update reload hint, the "offline ready"
  confirmation, and a live offline / pending-writes indicator. Rendered once in
  the app shell; each banner only appears when its condition holds.
-->
<script lang="ts">
  import { isOnline, pendingWrites } from '$lib/offline/index.js';
  import { initPwa } from '$lib/pwa/register.js';

  const { needRefresh, offlineReady, updateServiceWorker } = initPwa();
</script>

{#if $needRefresh}
  <div
    class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm bg-primary/10 text-primary"
    role="alert"
  >
    <span>Eine neue Version ist verfügbar.</span>
    <button
      type="button"
      class="cursor-pointer border border-current rounded-md bg-transparent px-3 py-1 font-[inherit] text-inherit hover:bg-primary/10 transition-colors"
      onclick={() => updateServiceWorker(true)}
    >
      Neu laden
    </button>
    <button
      type="button"
      class="cursor-pointer border-0 bg-transparent px-3 py-1 font-[inherit] text-inherit underline underline-offset-2 hover:no-underline transition-colors"
      onclick={() => needRefresh.set(false)}
    >
      Später
    </button>
  </div>
{:else if $offlineReady}
  <div
    class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm bg-muted text-muted-foreground border-b border-border"
    role="status"
  >
    <span>App ist offline einsatzbereit.</span>
    <button
      type="button"
      class="cursor-pointer border-0 bg-transparent px-3 py-1 font-[inherit] text-inherit underline underline-offset-2 hover:no-underline transition-colors"
      onclick={() => offlineReady.set(false)}
    >
      OK
    </button>
  </div>
{/if}

{#if !$isOnline}
  <div
    class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
    role="status"
  >
    <span>Offline – Änderungen werden gespeichert.</span>
    {#if $pendingWrites > 0}
      <span class="ml-auto tabular-nums">{$pendingWrites} ausstehend</span>
    {/if}
  </div>
{:else if $pendingWrites > 0}
  <div
    class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm bg-muted text-muted-foreground border-b border-border"
    role="status"
  >
    <span>{$pendingWrites} Änderung(en) werden synchronisiert …</span>
  </div>
{/if}
