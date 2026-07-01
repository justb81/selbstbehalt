<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  BRE-Verlauf-Diagramm der Jahresauswertung (docs/design.md §6.1, issue #28).
  Linienverlauf je Jahr aus BREHistory (#13): tatsächlich gebuchte vs. aus der
  Staffel prognostizierte Beitragsrückerstattung. `projected_bre` ist nullable
  (keine bre_structure hinterlegt), daher überspringt die gestrichelte Linie
  Jahre ohne Prognosewert statt fälschlich durch 0 zu laufen.
-->
<script lang="ts">
  import { formatEur, type BREHistoryYear } from '@selbstbehalt/shared';
  import { LineChart, Tooltip } from 'layerchart';

  let { data }: { data: BREHistoryYear[] } = $props();

  const series = [
    { key: 'bre_amount', label: 'Tatsächlich', color: 'var(--color-chart-1)' },
    {
      key: 'projected_bre',
      label: 'Prognostiziert',
      color: 'var(--color-chart-2)',
      props: {
        strokeDasharray: '4 4',
        defined: (d: BREHistoryYear) => d.projected_bre !== null,
      },
    },
  ];

  const chartData = $derived(data.map((d) => ({ ...d, yearLabel: String(d.year) })));
</script>

<div class="h-72 w-full text-xs">
  <LineChart
    data={chartData}
    x="yearLabel"
    {series}
    legend
    props={{ yAxis: { format: (v: number) => formatEur(v) } }}
  >
    {#snippet tooltip({ context })}
      <Tooltip.Root {context}>
        {#snippet children({ data: point })}
          <Tooltip.Header value={point.yearLabel} />
          <Tooltip.List>
            {#each series as s (s.key)}
              {@const value = point[s.key as keyof typeof point] as number | null}
              {#if value !== null}
                <Tooltip.Item label={s.label} value={formatEur(value)} color={s.color} />
              {/if}
            {/each}
          </Tooltip.List>
        {/snippet}
      </Tooltip.Root>
    {/snippet}
  </LineChart>
</div>
