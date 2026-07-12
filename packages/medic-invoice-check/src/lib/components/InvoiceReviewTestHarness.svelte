<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Test-only harness for InvoiceReview.svelte. InvoiceReview exposes its
  Rechnungskopf + positions via `bind:` props (the real parent, apps/frontend's
  InvoiceForm, owns that $state). Component tests need the same: a $state owner so
  nested mutations (e.g. recalculating a position's Betrag) stay reactive. This
  harness seeds that state once from props and binds it back. Not exported from
  the package barrel; used only by InvoiceReview.test.ts.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ProviderType } from '@selbstbehalt/shared';
  import InvoiceReview from './InvoiceReview.svelte';
  import type { ReviewPositionRow } from './invoice-review-types';
  import type { ScanResult } from '../ocr';

  let {
    mode,
    disabled = false,
    reparseOcrRaw = null,
    sharedFile = null,
    showBenefitCategory = false,
    initialPositions = [],
    initialInvoiceDate = '',
    initialInvoiceNumber = '',
    initialProviderName = '',
    initialProviderType = 'arzt',
    initialTotalAmount = 0,
  }: {
    mode: 'create' | 'edit';
    disabled?: boolean;
    reparseOcrRaw?: string | null;
    sharedFile?: File | null;
    showBenefitCategory?: boolean;
    initialPositions?: ReviewPositionRow[];
    initialInvoiceDate?: string;
    initialInvoiceNumber?: string;
    initialProviderName?: string;
    initialProviderType?: ProviderType;
    initialTotalAmount?: number;
  } = $props();

  // Seed once from props; the harness then owns the state (untrack marks the
  // initial-value reads as intentionally non-reactive).
  let positions = $state<ReviewPositionRow[]>(untrack(() => initialPositions));
  let invoiceDate = $state(untrack(() => initialInvoiceDate));
  let invoiceNumber = $state(untrack(() => initialInvoiceNumber));
  let providerName = $state(untrack(() => initialProviderName));
  let providerType = $state<ProviderType>(untrack(() => initialProviderType));
  let totalAmount = $state(untrack(() => initialTotalAmount));
  let scanResult = $state<ScanResult | null>(null);
</script>

<InvoiceReview
  {mode}
  {disabled}
  {reparseOcrRaw}
  {sharedFile}
  {showBenefitCategory}
  bind:invoiceDate
  bind:invoiceNumber
  bind:providerName
  bind:providerType
  bind:totalAmount
  bind:positions
  bind:scanResult
/>
