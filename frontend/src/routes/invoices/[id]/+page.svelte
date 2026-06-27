<!-- SPDX-License-Identifier: Apache-2.0 -->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  const invoiceId = $derived(page.params.id ?? '');
</script>

<svelte:head><title>Rechnungsdetail · selbstbehalt</title></svelte:head>

<section>
  <h1>Rechnungsdetail</h1>
  <p>Positionen und Günstigerprüfung für Rechnung <code>{invoiceId}</code> folgen mit #22.</p>
  <p>
    <a href={resolve('/invoices/[id]/submit', { id: invoiceId })}>Einreichung erfassen</a>
  </p>
</section>
