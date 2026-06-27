<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  // Top-level sections from docs/design.md §6.1. Sub-routes (new, detail, scan,
  // submit) are reached from within their section, not the primary nav.
  const items = [
    { href: '/', label: 'Dashboard' },
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

<nav aria-label="Hauptnavigation" class="nav">
  <ul>
    {#each items as item (item.href)}
      <li>
        <a
          href={resolve(item.href)}
          aria-current={isActive(item.href, page.url.pathname) ? 'page' : undefined}
        >
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .nav a {
    display: inline-block;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    font-weight: 500;
    text-decoration: none;
  }

  .nav a:hover {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .nav a[aria-current='page'] {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }
</style>
