<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { cn } from '$lib/utils';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ScanLineIcon from '@lucide/svelte/icons/scan-line';

  // Primary items shown directly in the top bar.
  const primaryItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/invoices', label: 'Rechnungen' },
    { href: '/stats', label: 'Auswertung' },
  ] as const;

  // Seldom-visited sections moved to the overflow dropdown.
  const overflowItems = [
    { href: '/persons', label: 'Personen' },
    { href: '/contracts', label: 'Verträge' },
    { href: '/settings', label: 'Einstellungen' },
  ] as const;

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const overflowActive = $derived(
    overflowItems.some((item) => isActive(item.href, page.url.pathname)),
  );
</script>

<!-- Desktop top navigation — hidden on mobile (BottomNav handles mobile). -->
<nav aria-label="Hauptnavigation" class="hidden sm:flex items-center gap-1 ml-auto sm:ml-0">
  {#each primaryItems as item (item.href)}
    {@const active = isActive(item.href, page.url.pathname)}
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
  {/each}

  <!-- Overflow: Personen, Verträge, Einstellungen -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class={cn(
        'inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer',
        overflowActive
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
      )}
    >
      Mehr
      <ChevronDownIcon class="size-4 shrink-0" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Group>
        {#each overflowItems as item (item.href)}
          <DropdownMenu.Item onclick={() => goto(resolve(item.href))}>
            {item.label}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <!-- Global capture shortcut -->
  <a
    href={resolve('/invoices/scan')}
    class="inline-flex items-center gap-1.5 ml-1 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors no-underline"
  >
    <ScanLineIcon class="size-4 shrink-0" />
    Erfassen
  </a>
</nav>
