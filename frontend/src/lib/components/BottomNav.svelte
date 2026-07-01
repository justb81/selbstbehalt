<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import * as Sheet from '$lib/components/ui/sheet';
  import { cn } from '$lib/utils';
  import ChartBarIcon from '@lucide/svelte/icons/chart-bar';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import FileBadgeIcon from '@lucide/svelte/icons/file-badge';
  import HouseIcon from '@lucide/svelte/icons/house';
  import ReceiptIcon from '@lucide/svelte/icons/receipt';
  import ScanLineIcon from '@lucide/svelte/icons/scan-line';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import UserCheckIcon from '@lucide/svelte/icons/user-check';
  import UsersIcon from '@lucide/svelte/icons/users';

  // Daily-goal items flanking the center FAB.
  const leftItems = [
    { href: '/', label: 'Dashboard', icon: HouseIcon },
    { href: '/invoices', label: 'Rechnungen', icon: ReceiptIcon },
  ] as const;

  const rightItems = [{ href: '/stats', label: 'Auswertung', icon: ChartBarIcon }] as const;

  // Seldom-visited sections surfaced via the bottom sheet.
  const overflowItems = [
    { href: '/persons', label: 'Personen', icon: UsersIcon },
    { href: '/contracts', label: 'Verträge', icon: FileBadgeIcon },
    { href: '/insured', label: 'Versicherte', icon: UserCheckIcon },
    { href: '/settings', label: 'Einstellungen', icon: SettingsIcon },
  ] as const;

  function isActive(href: string, pathname: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  let sheetOpen = $state(false);

  afterNavigate(() => {
    sheetOpen = false;
  });
</script>

<!-- Mobile-only bottom tab bar — hidden on sm+ (Nav handles desktop). -->
<Sheet.Root bind:open={sheetOpen}>
  <nav
    aria-label="Mobile Navigation"
    class="sm:hidden fixed bottom-0 left-0 right-0 z-50 h-16 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  >
    <div class="flex items-stretch justify-around h-full">
      {#each leftItems as item (item.href)}
        {@const active = isActive(item.href, page.url.pathname)}
        {@const Icon = item.icon}
        <a
          href={resolve(item.href)}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium no-underline transition-colors',
            active ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Icon class="size-5 shrink-0" />
          <span>{item.label}</span>
        </a>
      {/each}

      <!-- Center FAB: prominent global capture action -->
      <a
        href={resolve('/invoices/scan')}
        aria-label="Rechnung erfassen"
        class="flex flex-col items-center justify-center -mt-4 mx-2"
      >
        <span
          class="flex items-center justify-center size-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          <ScanLineIcon class="size-6 shrink-0" />
        </span>
        <span class="text-xs font-medium text-muted-foreground mt-0.5">Erfassen</span>
      </a>

      {#each rightItems as item (item.href)}
        {@const active = isActive(item.href, page.url.pathname)}
        {@const Icon = item.icon}
        <a
          href={resolve(item.href)}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium no-underline transition-colors',
            active ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Icon class="size-5 shrink-0" />
          <span>{item.label}</span>
        </a>
      {/each}

      <!-- "Mehr" trigger for overflow sections -->
      <Sheet.Trigger
        class={cn(
          'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors bg-transparent border-none cursor-pointer',
          overflowItems.some((i) => isActive(i.href, page.url.pathname))
            ? 'text-primary'
            : 'text-muted-foreground',
        )}
      >
        <EllipsisIcon class="size-5 shrink-0" />
        <span>Mehr</span>
      </Sheet.Trigger>
    </div>
  </nav>

  <!-- Bottom sheet for Personen, Verträge, Einstellungen -->
  <Sheet.Content side="bottom">
    <Sheet.Header>
      <Sheet.Title>Weitere Navigation</Sheet.Title>
    </Sheet.Header>
    <div class="flex flex-col gap-1 mt-2 pb-2">
      {#each overflowItems as item (item.href)}
        {@const active = isActive(item.href, page.url.pathname)}
        {@const Icon = item.icon}
        <a
          href={resolve(item.href)}
          aria-current={active ? 'page' : undefined}
          class={cn(
            'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium no-underline transition-colors',
            active
              ? 'bg-primary/5 text-primary font-semibold'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <Icon class="size-5 shrink-0" />
          {item.label}
        </a>
      {/each}
    </div>
  </Sheet.Content>
</Sheet.Root>
