<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { cn } from '$lib/utils';

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

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }
</script>

<nav aria-label="Hauptnavigation">
  <ul class="flex flex-wrap gap-1 m-0 p-0 list-none">
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
