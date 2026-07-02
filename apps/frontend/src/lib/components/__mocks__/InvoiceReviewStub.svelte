<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Test double for @selbstbehalt/medic-invoice-check's <InvoiceReview>, used by
  InvoiceForm.test.ts. InvoiceForm is a thin wrapper; its own behaviour (person
  selection, Notizen, reimbursement, save-payload assembly) is what those tests
  exercise. This stub stands in for the review component so the wrapper can be
  tested in isolation: it declares the same bind:-prop contract and renders the
  two Rechnungskopf fields the wrapper's tests type into. The full review
  behaviour is covered by InvoiceReview.test.ts in the package itself.
-->
<script lang="ts">
  import type { ProviderType } from '@selbstbehalt/shared';
  import type { ReviewPositionRow, ScanResult } from '@selbstbehalt/medic-invoice-check';

  // Only the bindable props are declared — the wrapper's non-bound props (mode,
  // disabled, reparseOcrRaw, sharedFile) are simply ignored by this stub.
  let {
    invoiceDate = $bindable(''),
    invoiceNumber = $bindable(''),
    providerName = $bindable(''),
    providerType = $bindable<ProviderType>('arzt'),
    totalAmount = $bindable(0),
    positions = $bindable<ReviewPositionRow[]>([]),
    scanResult = $bindable<ScanResult | null>(null),
  }: {
    invoiceDate?: string;
    invoiceNumber?: string;
    providerName?: string;
    providerType?: ProviderType;
    totalAmount?: number;
    positions?: ReviewPositionRow[];
    scanResult?: ScanResult | null;
  } = $props();
</script>

<div data-testid="invoice-review-stub" data-provider-type={providerType}>
  <label>
    Leistungserbringer
    <input type="text" bind:value={providerName} />
  </label>
  <label>
    Rechnungsbetrag (€)
    <input type="number" bind:value={totalAmount} />
  </label>
  <span data-testid="stub-positions-count">{positions.length}</span>
  <span data-testid="stub-invoice-date">{invoiceDate}</span>
  <span data-testid="stub-invoice-number">{invoiceNumber}</span>
  <span data-testid="stub-scanned">{scanResult ? 'yes' : 'no'}</span>
</div>
