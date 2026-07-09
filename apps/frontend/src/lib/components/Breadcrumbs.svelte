<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Global, route-based breadcrumb trail (issue #133): a single component rendered
  once in the AppShell, above every page's h1. Pattern: `Bereich › Objekt ›
  Aktion`, one separator (the shadcn chevron). Top-level pages (dashboard,
  section lists, /stats, /settings) show no trail — the top-bar brand + nav
  already anchor those. The object crumb shows the real entity name via the
  breadcrumbEntity store (a detail page sets it once its data loads); a generic
  fallback covers the brief window before that.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { breadcrumbEntity, type BreadcrumbEntity } from '$lib/stores/breadcrumb';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';

  type Crumb = { label: string; href?: string };

  // Route segment metadata for building human-readable breadcrumb trails. Only
  // sections with sub-routes need an entry; single-segment sections (stats,
  // settings) never render a trail so they are intentionally omitted.
  const sectionMeta: Record<string, { label: string; entityFallback: string; newLabel: string }> = {
    invoices: { label: 'Rechnungen', entityFallback: 'Rechnung', newLabel: 'Neue Rechnung' },
    contracts: { label: 'Verträge', entityFallback: 'Vertrag', newLabel: 'Neuer Vertrag' },
    persons: { label: 'Personen', entityFallback: 'Person', newLabel: 'Neue Person' },
    insured: { label: 'Versicherte', entityFallback: 'Versicherte Person', newLabel: 'Neu' },
  };

  const actionLabels: Record<string, string> = {
    edit: 'Bearbeiten',
    submit: 'Einreichung',
  };

  function buildCrumbs(pathname: string, entity: BreadcrumbEntity | null): Crumb[] {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 2) return []; // dashboard, section lists, /stats, /settings — no trail

    const section = parts[0]!;
    const id = parts[1]!;
    const action = parts[2]; // string | undefined

    const meta = sectionMeta[section];
    if (!meta) return [];

    const crumbs: Crumb[] = [{ label: meta.label, href: `/${section}` }];

    if (id === 'new') {
      crumbs.push({ label: meta.newLabel });
      return crumbs;
    }

    // The real object name once the detail page has loaded it (keyed by the
    // [id] segment so a previous page's label can't leak in); generic until then.
    const objectLabel = entity && entity.id === id ? entity.label : meta.entityFallback;

    if (action !== undefined) {
      crumbs.push({ label: objectLabel, href: `/${section}/${id}` });
      crumbs.push({ label: actionLabels[action] ?? action });
    } else {
      crumbs.push({ label: objectLabel });
    }

    return crumbs;
  }

  const crumbs = $derived(buildCrumbs(page.url.pathname, $breadcrumbEntity));
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
