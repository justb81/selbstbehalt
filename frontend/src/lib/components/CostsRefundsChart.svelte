<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Kosten-vs-Erstattungen-Diagramm der Jahresauswertung (docs/design.md §6.1, issue #28).
  Gruppierte Balken je Jahr aus YearStats (#13): Gesamtkosten, Erstattet, Selbst getragen.
-->
<script lang="ts">
  import { formatEur, type YearStats } from '@selbstbehalt/shared';
  import { BarChart, Tooltip } from 'layerchart';

  let { data }: { data: YearStats[] } = $props();

  const series = [
    { key: 'total_amount', label: 'Gesamtkosten', color: 'var(--color-chart-1)' },
    { key: 'refund_amount', label: 'Erstattet', color: 'var(--color-chart-2)' },
    { key: 'self_paid_amount', label: 'Selbst getragen', color: 'var(--color-chart-3)' },
  ];

  const chartData = $derived(data.map((d) => ({ ...d, yearLabel: String(d.year) })));
</script>

<div class="h-72 w-full text-xs">
  <BarChart
    data={chartData}
    x="yearLabel"
    {series}
    seriesLayout="group"
    legend
    props={{ yAxis: { format: (v: number) => formatEur(v) } }}
  >
    {#snippet tooltip({ context })}
      <Tooltip.Root {context}>
        {#snippet children({ data: point })}
          <Tooltip.Header value={point.yearLabel} />
          <Tooltip.List>
            {#each series as s (s.key)}
              <Tooltip.Item
                label={s.label}
                value={formatEur(point[s.key as keyof typeof point] as number)}
                color={s.color}
              />
            {/each}
          </Tooltip.List>
        {/snippet}
      </Tooltip.Root>
    {/snippet}
  </BarChart>
</div>
