<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { cn } from '$lib/utils';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import XIcon from '@lucide/svelte/icons/x';

  // Top-level sections from docs/design.md §6.1. Sub-routes (new, detail, scan,
  // submit) are reached from within their section, not the primary nav.
  const items = [
    { href: '/', label: 'Dashboard' },
    { href: '/persons', label: 'Personen' },
    { href: '/contracts', label: 'Verträge' },
    { href: '/invoices', label: 'Rechnungen' },
    { href: '/stats', label: 'Auswertung' },
    { href: '/settings', label: 'Einstellungen' },
  ] as const;

  let isOpen = $state(false);

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Close the mobile menu whenever the route changes.
  afterNavigate(() => {
    isOpen = false;
  });
</script>

<nav aria-label="Hauptnavigation" class="ml-auto sm:ml-0">
  <!-- Hamburger toggle — only visible on mobile -->
  <button
    class="sm:hidden flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
    onclick={() => (isOpen = !isOpen)}
    aria-expanded={isOpen}
    aria-controls="main-nav-menu"
    aria-label={isOpen ? 'Menü schließen' : 'Menü öffnen'}
  >
    {#if isOpen}
      <XIcon class="size-5" />
    {:else}
      <MenuIcon class="size-5" />
    {/if}
  </button>

  <!-- Links: always visible on sm+; shown as fixed dropdown on mobile when open -->
  <ul
    id="main-nav-menu"
    class={cn(
      'm-0 p-0 list-none gap-1',
      isOpen
        ? 'fixed top-14 left-0 right-0 z-50 flex flex-col bg-background border-b border-border px-4 py-3 shadow-lg'
        : 'hidden sm:flex flex-wrap',
    )}
  >
    {#each items as item (item.href)}
      {@const active = isActive(item.href, page.url.pathname)}
      <li>
        <a
          href={resolve(item.href)}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'inline-block px-3 py-2 rounded-md text-sm font-medium no-underline transition-colors',
            active
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
          )}
        >
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
