<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';

  type Crumb = { label: string; href?: string };

  // Route segment metadata for building human-readable breadcrumb trails.
  const sectionMeta: Record<string, { label: string; entityLabel: string; newLabel: string }> = {
    invoices: { label: 'Rechnungen', entityLabel: 'Rechnung', newLabel: 'Neue Rechnung' },
    contracts: { label: 'Verträge', entityLabel: 'Vertrag', newLabel: 'Neuer Vertrag' },
    persons: { label: 'Personen', entityLabel: 'Person', newLabel: 'Neue Person' },
    insured: { label: 'Versicherte', entityLabel: 'Versicherte Person', newLabel: '' },
    stats: { label: 'Auswertung', entityLabel: '', newLabel: '' },
    settings: { label: 'Einstellungen', entityLabel: '', newLabel: '' },
  };

  const actionLabels: Record<string, string> = {
    edit: 'Bearbeiten',
    submit: 'Einreichen',
  };

  function buildCrumbs(pathname: string): Crumb[] {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 2) return []; // root or top-level section — no breadcrumbs

    const section = parts[0]!;
    const id = parts[1]!;
    const action = parts[2]; // string | undefined

    const meta = sectionMeta[section];
    if (!meta) return [];

    const crumbs: Crumb[] = [{ label: meta.label, href: `/${section}` }];

    if (id === 'new') {
      crumbs.push({ label: meta.newLabel || 'Neu' });
    } else if (id === 'scan') {
      crumbs.push({ label: 'Scan' });
    } else if (action !== undefined) {
      crumbs.push({ label: meta.entityLabel || 'Detail', href: `/${section}/${id}` });
      crumbs.push({ label: actionLabels[action] ?? action });
    } else {
      crumbs.push({ label: meta.entityLabel || 'Detail' });
    }

    return crumbs;
  }

  const crumbs = $derived(buildCrumbs(page.url.pathname));
</script>

{#if crumbs.length > 0}
  <Breadcrumb.Root class="mb-4">
    <Breadcrumb.List>
      {#each crumbs as crumb, i (i)}
        <Breadcrumb.Item>
          {#if crumb.href}
            <Breadcrumb.Link href={`${base}${crumb.href}`}>{crumb.label}</Breadcrumb.Link>
          {:else}
            <Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
          {/if}
        </Breadcrumb.Item>
        {#if i < crumbs.length - 1}
          <Breadcrumb.Separator />
        {/if}
      {/each}
    </Breadcrumb.List>
  </Breadcrumb.Root>
{/if}
