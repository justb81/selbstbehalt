<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Shared invoice form used by both the create page (/invoices/new) and the edit
  page (/invoices/[id]/edit). Mode-specific features:
    create — OCR scanner, OCR opt-in checkbox
    edit   — pre-filled from initialData
  "Positionen prüfen" is available in both modes whenever there are positions.
-->
<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import {
    goaeCategoryValues,
    providerTypeValues,
    roundCents,
    type BenefitCategory,
    type GoaeCategory,
    type InvoicePositionInput,
    type InvoiceWithPositions,
    type InsuredPerson,
    type ProviderType,
  } from '@selbstbehalt/shared';
  import {
    DEFAULT_CONFIDENCE_THRESHOLD,
    defaultProviderType,
    disposeScanOcr,
    toReviewPositions,
    type ScanResult,
  } from '$lib/ocr';
  import { loadFeeTable } from '$lib/data/fee-tables';
  import { buildIndex, lookupPosition, type RawPosition } from '$lib/utils/goae-parser';
  import type { FeeScheduleId } from '$lib/data/fee-schedule';
  import { computeErstattung, type ErstattungPosition } from '$lib/utils/erstattungs-engine';
  import OCRScanner from './OCRScanner.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from '$lib/components/ui/table';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { cn } from '$lib/utils';

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  type PositionRow = {
    goae_number: string;
    goae_category: GoaeCategory | null;
    quantity: number;
    treatment_date: string; // ISO YYYY-MM-DD or '' for null
    description: string;
    multiplier: number;
    base_amount: number;
    charged_amount: number;
    is_valid: boolean | null;
    flag_reason: string | null;
    confidence: number;
  };

  export type FormPayload = {
    insured_person_id: string;
    invoice_date: string;
    invoice_number: string | null;
    provider_name: string;
    provider_type: ProviderType | null;
    total_amount: number;
    eligible_amount: number | null;
    notes: string | null;
    ocr_raw: string | null;
    positions: InvoicePositionInput[];
  };

  const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
    arzt: 'Arzt/Ärztin',
    zahnarzt: 'Zahnarzt/Zahnärztin',
    krankenhaus: 'Krankenhaus',
    sonstiges: 'Sonstiges',
  };

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  let {
    mode,
    initialData = undefined,
    insuredOptions,
    cancel,
    disabled = false,
    saving = false,
    formError = null,
    onSave,
  }: {
    mode: 'create' | 'edit';
    initialData?: InvoiceWithPositions;
    insuredOptions: { id: string; label: string; insuredPerson?: InsuredPerson }[];
    /** Snippet rendered next to the submit button — typically a cancel link from the parent. */
    cancel?: Snippet;
    disabled?: boolean;
    saving?: boolean;
    formError?: string | null;
    onSave: (payload: FormPayload) => void;
  } = $props();

  // ---------------------------------------------------------------------------
  // Form state — initialised once from props; the form then owns its own state.
  // untrack() tells Svelte the initial-value reads are intentionally non-reactive.
  // ---------------------------------------------------------------------------

  let insuredPersonId = $state(
    untrack(() => initialData?.insured_person_id ?? insuredOptions[0]?.id ?? ''),
  );
  let invoiceDate = $state(
    untrack(() => initialData?.invoice_date ?? new Date().toISOString().slice(0, 10)),
  );
  let invoiceNumber = $state(untrack(() => initialData?.invoice_number ?? ''));
  let providerName = $state(untrack(() => initialData?.provider_name ?? ''));
  let providerType = $state<ProviderType>(untrack(() => initialData?.provider_type ?? 'arzt'));
  let totalAmount = $state<number>(untrack(() => initialData?.total_amount ?? 0));
  let eligibleAmount = $state<number | null>(untrack(() => initialData?.eligible_amount ?? null));
  let notes = $state(untrack(() => initialData?.notes ?? ''));

  function rowFromPosition(p: InvoiceWithPositions['positions'][number]): PositionRow {
    return {
      goae_number: p.goae_number,
      goae_category: p.goae_category ?? null,
      quantity: p.quantity ?? 1,
      treatment_date: p.treatment_date ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount: p.base_amount,
      charged_amount: p.charged_amount,
      is_valid: p.is_valid ?? null,
      flag_reason: p.flag_reason ?? null,
      confidence: 1,
    };
  }

  let positions = $state<PositionRow[]>(
    untrack(() => initialData?.positions.map(rowFromPosition) ?? []),
  );

  function addPosition() {
    positions = [
      ...positions,
      {
        goae_number: '',
        goae_category: 'GOÄ' as GoaeCategory,
        quantity: 1,
        treatment_date: '',
        description: '',
        multiplier: 2.3,
        base_amount: 0,
        charged_amount: 0,
        is_valid: null,
        flag_reason: null,
        confidence: 1,
      },
    ];
  }

  function removePosition(i: number) {
    positions = positions.filter((_, idx) => idx !== i);
  }

  // ---------------------------------------------------------------------------
  // OCR (create mode only)
  // ---------------------------------------------------------------------------

  let scanResult = $state<ScanResult | null>(null);
  let showScanner = $state(false);
  let ocrSchedule = $state<FeeScheduleId>('GOÄ');
  let saveOcrRaw = $state(false);

  const hasScan = $derived(scanResult !== null);
  const lowConfidence = $derived(
    scanResult !== null && scanResult.meanConfidence < DEFAULT_CONFIDENCE_THRESHOLD,
  );
  const flaggedCount = $derived(positions.filter((p) => p.is_valid === false).length);

  function onScanned(result: ScanResult): void {
    scanResult = result;
    showScanner = false;
    if (result.parsed.invoiceDate) invoiceDate = result.parsed.invoiceDate;
    if (result.parsed.invoiceNumber) invoiceNumber = result.parsed.invoiceNumber;
    if (result.parsed.providerName) providerName = result.parsed.providerName;
    providerType = defaultProviderType(result.schedule);
    positions = toReviewPositions(result).map((p) => ({
      goae_number: p.goaeNumber,
      goae_category: result.schedule as GoaeCategory,
      quantity: p.quantity,
      treatment_date: p.treatmentDate ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount: p.baseAmount,
      charged_amount: p.chargedAmount,
      is_valid: p.isValid,
      flag_reason: p.flagReason,
      confidence: p.confidence,
    }));
    if (positions.length > 0) {
      totalAmount = roundCents(positions.reduce((s, p) => s + p.charged_amount, 0));
    }
  }

  // Teardown the OCR worker when the page unmounts (no-op in edit mode since
  // the scanner is never initialised there).
  onDestroy(disposeScanOcr);

  // ---------------------------------------------------------------------------
  // Re-validate positions
  // ---------------------------------------------------------------------------

  let revalidating = $state(false);
  let revalidateError = $state<string | null>(null);

  function categoryToSchedule(cat: GoaeCategory | null): FeeScheduleId {
    if (cat === 'GOZ') return 'GOZ';
    if (cat === 'GOT') return 'GOT';
    return 'GOÄ'; // GOÄ and UV-GOÄ both validate against the GOÄ table
  }

  async function revalidatePositions() {
    if (positions.length === 0) return;
    revalidating = true;
    revalidateError = null;
    try {
      const schedules = new Set(positions.map((p) => categoryToSchedule(p.goae_category)));
      const tableEntries = await Promise.all(
        [...schedules].map(async (s) => [s, await loadFeeTable(s)] as const),
      );
      const tables = new Map(tableEntries);
      const indexes = new Map([...tables.entries()].map(([s, t]) => [s, buildIndex(t)]));

      // Collect benefitCategory per position for eligible_amount computation below.
      const benefitCategories: (BenefitCategory | null)[] = [];

      positions = positions.map((pos) => {
        const schedule = categoryToSchedule(pos.goae_category);
        const table = tables.get(schedule)!;
        const index = indexes.get(schedule)!;
        const raw: RawPosition = {
          ziffer: pos.goae_number,
          quantity: pos.quantity,
          multiplier: pos.multiplier,
          chargedAmount: pos.charged_amount,
          raw: pos.goae_number,
          treatmentDate: pos.treatment_date || null,
          detectedSchedule: null,
        };
        const result = lookupPosition(raw, table, index);
        benefitCategories.push(result.benefitCategory);
        return {
          ...pos,
          // Supplement description from fee table if currently empty.
          description: pos.description || result.description || '',
          // Always take base_amount from the table when the Ziffer is known.
          base_amount: result.baseAmount ?? pos.base_amount,
          is_valid: result.isValid,
          flag_reason: result.flags.length > 0 ? result.flags.map((f) => f.reason).join(' ') : null,
        };
      });

      // Propagate treatment_date forward: positions without their own date
      // inherit from the nearest preceding position that has one.
      let lastDate = '';
      positions = positions.map((pos) => {
        if (pos.treatment_date) {
          lastDate = pos.treatment_date;
          return pos;
        }
        return lastDate ? { ...pos, treatment_date: lastDate } : pos;
      });

      // Recalculate eligible_amount when the insured person's tariff data is
      // available. Positions with an unknown Ziffer (benefitCategory == null)
      // fall back to 'sonstiges'; the tariff will return 0 for uncovered areas.
      const insuredPerson = insuredOptions.find((o) => o.id === insuredPersonId)?.insuredPerson;
      if (insuredPerson?.included_benefits && insuredPerson.start_date) {
        const erstattungPositions: ErstattungPosition[] = positions.map((pos, i) => ({
          category: (benefitCategories[i] ?? 'sonstiges') as BenefitCategory,
          chargedAmount: pos.charged_amount,
        }));
        const result = computeErstattung({
          positions: erstattungPositions,
          benefits: insuredPerson.included_benefits,
          invoiceDate,
          coverageStart: insuredPerson.start_date,
        });
        eligibleAmount = result.eligibleAmount;
      }
    } catch (e) {
      revalidateError = e instanceof Error ? e.message : 'Neuprüfung fehlgeschlagen.';
    } finally {
      revalidating = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  let internalError = $state<string | null>(null);
  const displayError = $derived(internalError ?? formError);

  function handleSubmit() {
    internalError = null;
    if (!insuredPersonId) {
      internalError = 'Bitte eine versicherte Person auswählen.';
      return;
    }
    if (!providerName.trim()) {
      internalError = 'Bitte den Leistungserbringer eingeben.';
      return;
    }
    if (!(totalAmount > 0)) {
      internalError = 'Bitte einen Gesamtbetrag > 0 eingeben.';
      return;
    }

    const positionInputs: InvoicePositionInput[] = positions.map((p) => ({
      goae_number: p.goae_number,
      goae_category: p.goae_category,
      quantity: p.quantity,
      treatment_date: p.treatment_date || null,
      description: p.description.trim() || null,
      multiplier: p.multiplier,
      base_amount: p.base_amount,
      charged_amount: p.charged_amount,
      is_valid: p.is_valid,
      flag_reason: p.flag_reason,
    }));

    onSave({
      insured_person_id: insuredPersonId,
      invoice_date: invoiceDate,
      invoice_number: invoiceNumber.trim() || null,
      provider_name: providerName.trim(),
      provider_type: providerType,
      total_amount: totalAmount,
      eligible_amount: eligibleAmount,
      notes: notes.trim() || null,
      ocr_raw: mode === 'create' && hasScan && saveOcrRaw ? (scanResult?.ocrText ?? null) : null,
      positions: positionInputs,
    });
  }

  // Shared class for native <select> elements inside the positions table
  // (styled to match shadcn Input dimensions).
  const nativeSelectClass =
    'border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<form
  class="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
  novalidate
  onsubmit={(e) => {
    e.preventDefault();
    handleSubmit();
  }}
>
  <!-- OCR section (create mode only) -->
  {#if mode === 'create'}
    <div class="flex flex-col gap-3 border-b border-border pb-4">
      <div class="flex flex-wrap items-center gap-3">
        {#if !showScanner}
          <Button type="button" variant="outline" onclick={() => (showScanner = true)} {disabled}>
            {hasScan ? 'Neu scannen / hochladen' : 'Rechnung scannen / hochladen'}
          </Button>
          {#if hasScan}
            <span class="text-sm text-green-600 dark:text-green-500">
              ✓ Aus Scan übernommen – bitte prüfen
            </span>
          {:else}
            <span class="text-sm text-muted-foreground">
              Optional. Die Erkennung läuft auf diesem Gerät; das Bild verlässt es nie.
            </span>
          {/if}
        {:else}
          <Button type="button" variant="ghost" size="sm" onclick={() => (showScanner = false)}>
            Schließen
          </Button>
        {/if}
      </div>
      {#if showScanner}
        <OCRScanner bind:schedule={ocrSchedule} {onScanned} />
      {/if}
    </div>

    {#if hasScan && lowConfidence}
      <Alert>
        <AlertDescription>
          Geringe Erkennungsgenauigkeit – bitte alle Felder und Positionen sorgfältig prüfen.
        </AlertDescription>
      </Alert>
    {/if}
    {#if hasScan && flaggedCount > 0}
      <Alert>
        <AlertDescription>
          {flaggedCount}
          {flaggedCount === 1 ? 'Position ist' : 'Positionen sind'} auffällig und markiert.
        </AlertDescription>
      </Alert>
    {/if}
    {#if hasScan && (scanResult?.parsed.violations.length ?? 0) > 0}
      <ul class="list-disc pl-5 text-sm text-amber-600 dark:text-amber-500">
        {#each scanResult?.parsed.violations ?? [] as violation (violation.message)}
          <li>{violation.message}</li>
        {/each}
      </ul>
    {/if}
  {/if}

  <!-- Header fields -->
  <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Rechnungskopf</p>
  <div class="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
    <!-- Versicherte Person -->
    <div class="space-y-1.5">
      <Label for="field-insured">
        Versicherte Person <span class="text-destructive">*</span>
      </Label>
      <Select
        type="single"
        value={insuredPersonId}
        onValueChange={(v: string) => (insuredPersonId = v ?? '')}
        disabled={disabled || insuredOptions.length === 0}
      >
        <SelectTrigger id="field-insured" class="w-full">
          <SelectValue placeholder="Bitte wählen …" />
        </SelectTrigger>
        <SelectContent>
          {#each insuredOptions as opt (opt.id)}
            <SelectItem value={opt.id} label={opt.label} />
          {/each}
        </SelectContent>
      </Select>
    </div>

    <!-- Rechnungsdatum -->
    <div class="space-y-1.5">
      <Label for="field-date">
        Rechnungsdatum <span class="text-destructive">*</span>
      </Label>
      <Input id="field-date" type="date" bind:value={invoiceDate} required {disabled} />
    </div>

    <!-- Rechnungsnummer -->
    <div class="space-y-1.5">
      <Label for="field-number">Rechnungsnummer</Label>
      <Input
        id="field-number"
        type="text"
        bind:value={invoiceNumber}
        placeholder="optional"
        {disabled}
      />
    </div>

    <!-- Leistungserbringer -->
    <div class="space-y-1.5">
      <Label for="field-provider">
        Leistungserbringer <span class="text-destructive">*</span>
      </Label>
      <Input id="field-provider" type="text" bind:value={providerName} required {disabled} />
    </div>

    <!-- Art -->
    <div class="space-y-1.5">
      <Label for="field-type">Art</Label>
      <Select
        type="single"
        value={providerType}
        onValueChange={(v: string) => {
          if (v) providerType = v as ProviderType;
        }}
        {disabled}
      >
        <SelectTrigger id="field-type" class="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {#each providerTypeValues as t (t)}
            <SelectItem value={t} label={PROVIDER_TYPE_LABELS[t]} />
          {/each}
        </SelectContent>
      </Select>
    </div>

    <!-- Rechnungsbetrag -->
    <div class="space-y-1.5">
      <Label for="field-total">
        Rechnungsbetrag (€) <span class="text-destructive">*</span>
      </Label>
      <Input
        id="field-total"
        type="number"
        bind:value={totalAmount}
        min="0"
        step="0.01"
        required
        {disabled}
      />
    </div>

    <!-- Erstattungsfähiger Betrag -->
    <div class="space-y-1.5">
      <Label for="field-eligible">Erstattungsfähiger Betrag (€)</Label>
      <Input
        id="field-eligible"
        type="number"
        value={eligibleAmount ?? ''}
        oninput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          eligibleAmount = v ? parseFloat(v) : null;
        }}
        min="0"
        step="0.01"
        placeholder="optional"
        {disabled}
      />
    </div>
  </div>

  <!-- Notizen -->
  <div class="space-y-1.5">
    <Label for="field-notes">Notizen</Label>
    <Textarea id="field-notes" bind:value={notes} rows={2} {disabled} />
  </div>

  <!-- Positions -->
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        GOÄ/GOZ-Positionen
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onclick={revalidatePositions}
          disabled={revalidating || disabled || positions.length === 0}
        >
          {revalidating ? 'Wird geprüft …' : 'Positionen prüfen'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onclick={addPosition} {disabled}>
          + Position hinzufügen
        </Button>
      </div>
    </div>

    {#if revalidateError}
      <Alert variant="destructive">
        <AlertDescription>{revalidateError}</AlertDescription>
      </Alert>
    {/if}

    {#if positions.length > 0}
      <div class="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-32">Datum</TableHead>
              <TableHead class="w-20">Ziffer</TableHead>
              <TableHead class="w-16">Kat.</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead class="w-20 text-right">Faktor</TableHead>
              <TableHead class="w-14 text-right">Anz.</TableHead>
              <TableHead class="w-26 text-right">Basis (€)</TableHead>
              <TableHead class="w-26 text-right">Betrag (€)</TableHead>
              <TableHead class="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each positions as pos, i (i)}
              <TableRow class={cn(pos.is_valid === false && 'bg-amber-50 dark:bg-amber-950/20')}>
                <TableCell class="align-top p-1.5">
                  <Input type="date" bind:value={pos.treatment_date} {disabled} />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Input
                    type="text"
                    bind:value={pos.goae_number}
                    placeholder="z.B. 1"
                    required
                    {disabled}
                  />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <select bind:value={pos.goae_category} {disabled} class={nativeSelectClass}>
                    {#each goaeCategoryValues as cat (cat)}
                      <option value={cat}>{cat}</option>
                    {/each}
                  </select>
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <div class="flex flex-col gap-1 min-w-0">
                    <Input
                      type="text"
                      bind:value={pos.description}
                      placeholder="optional"
                      {disabled}
                    />
                    {#if pos.is_valid === false && pos.flag_reason}
                      <p class="text-xs text-amber-600 dark:text-amber-500">
                        ⚠ {pos.flag_reason}
                      </p>
                    {/if}
                    {#if pos.confidence < DEFAULT_CONFIDENCE_THRESHOLD}
                      <p class="text-xs italic text-muted-foreground">
                        Unsichere Erkennung – bitte prüfen.
                      </p>
                    {/if}
                  </div>
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Input
                    type="number"
                    bind:value={pos.multiplier}
                    min="0.01"
                    step="0.01"
                    required
                    {disabled}
                    class="text-right"
                  />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Input
                    type="number"
                    bind:value={pos.quantity}
                    min="1"
                    step="1"
                    required
                    {disabled}
                    class="text-right"
                  />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Input
                    type="number"
                    bind:value={pos.base_amount}
                    min="0"
                    step="0.01"
                    required
                    {disabled}
                    class="text-right"
                  />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Input
                    type="number"
                    bind:value={pos.charged_amount}
                    min="0"
                    step="0.01"
                    required
                    {disabled}
                    class="text-right"
                  />
                </TableCell>
                <TableCell class="align-top p-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onclick={() => removePosition(i)}
                    aria-label="Position {i + 1} entfernen"
                    {disabled}
                    class="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    ✕
                  </Button>
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">Noch keine Positionen. Positionen sind optional.</p>
    {/if}
  </div>

  <!-- OCR opt-in checkbox (create mode only, after a scan) -->
  {#if mode === 'create' && hasScan}
    <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
      <input type="checkbox" bind:checked={saveOcrRaw} class="rounded border-border" />
      <span>OCR-Rohtext zur späteren Kontrolle speichern (optional, Opt-in)</span>
    </label>
  {/if}

  {#if displayError}
    <Alert variant="destructive">
      <AlertDescription>{displayError}</AlertDescription>
    </Alert>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Button type="submit" disabled={saving || disabled}>
      {saving
        ? 'Wird gespeichert …'
        : mode === 'create'
          ? 'Rechnung speichern'
          : 'Änderungen speichern'}
    </Button>
    {#if cancel}{@render cancel()}{/if}
  </div>
</form>
