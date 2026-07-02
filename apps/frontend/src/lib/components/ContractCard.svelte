<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Contract summary card (docs/design.md §6.2, issue #21). -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { type Contract, type ContractType } from '@selbstbehalt/shared';
  import { Card, CardHeader, CardContent, CardFooter } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';

  let {
    contract,
    insuredCount = 0,
  }: {
    contract: Contract;
    insuredCount?: number;
  } = $props();

  const TYPE_LABELS: Record<ContractType, string> = {
    vollversicherung: 'Vollversicherung',
    zusatztarif: 'Zusatztarif',
    beihilfe: 'Beihilfe',
  };
</script>

<a href={resolve('/contracts/[id]', { id: contract.id })} class="block no-underline text-inherit">
  <Card class="hover:shadow-md transition-shadow cursor-pointer hover:border-primary">
    <CardHeader class="flex-row items-center justify-between gap-2 flex-wrap">
      <strong class="text-base font-semibold text-foreground">{contract.insurer_name}</strong>
      <Badge variant="secondary">{TYPE_LABELS[contract.type]}</Badge>
    </CardHeader>

    {#if contract.contract_number}
      <CardContent class="text-sm text-muted-foreground">
        Nr. {contract.contract_number}
      </CardContent>
    {/if}

    <CardFooter
      class="flex justify-between items-center gap-2 flex-wrap text-sm text-muted-foreground"
    >
      <span class="font-medium">
        {insuredCount}
        {insuredCount === 1 ? 'versicherte Person' : 'versicherte Personen'}
      </span>
      {#if contract.end_date}
        <span>bis {contract.end_date}</span>
      {:else}
        <span>seit {contract.start_date}</span>
      {/if}
    </CardFooter>
  </Card>
</a>
