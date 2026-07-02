<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Shared invoice form used by both the create page (/invoices/new) and the edit
  page (/invoices/[id]/edit). Mode-specific features:
    create — OCR scanner, OCR opt-out checkbox (raw OCR saved by default)
    edit   — pre-filled from initialData; "Neu einlesen" button when ocr_raw is
             stored and status is 'neu'
  Positions are re-validated automatically (debounced) whenever Kategorie,
  Ziffer, Faktor or Anzahl changes — see the `revalidationKey` effect below.
  Info-Icon next to Ziffer + Kat. opens a dialog with the fee schedule entry.
-->
<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import {
    formatEur,
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
  import {
    buildIndex,
    isAuslagenersatzDescription,
    lookupPosition,
    normalizeZiffer,
    parseInvoice,
    validatePositions,
    type ParsedPosition,
    type RawPosition,
  } from '$lib/utils/goae-parser';
  import type { FeeEntry, FeeScheduleId } from '$lib/data/fee-schedule';
  import { computeErstattung, type ErstattungPosition } from '$lib/utils/erstattungs-engine';
  import OCRScanner from './OCRScanner.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import { DialogRoot, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import InfoIcon from '@lucide/svelte/icons/info';
  import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
  import { cn } from '$lib/utils';

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  type PositionRow = {
    goae_number: string;
    goae_category: GoaeCategory | null;
    quantity: number;
    treatment_date: string; // ISO YYYY-MM-DD or '' (defaults to invoiceDate on submit)
    description: string;
    multiplier: number;
    base_amount: number;
    charged_amount: number;
    eligible_amount: number | null; // computed by engine, read-only
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

  /** Display label override for `goae_category` options; falls back to the raw value. */
  const GOAE_CATEGORY_LABELS: Partial<Record<GoaeCategory, string>> = {
    Auslagenersatz: 'Auslagenersatz (§10 GOÄ)',
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
    sharedFile = null,
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
    /** A file handed in from the PWA share target (issue #158); opens the scanner and scans it automatically. */
    sharedFile?: File | null;
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
      eligible_amount: p.eligible_amount ?? null,
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
        eligible_amount: null,
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
  // Saved by default — users can opt out before saving.
  let saveOcrRaw = $state(true);
  // Own copy of `sharedFile` (issue #158): cleared once consumed so a later
  // manual "Neu scannen / hochladen" opens a fresh scanner instead of
  // re-auto-scanning the same shared PDF.
  let autoFile = $state<File | null>(null);

  $effect(() => {
    if (sharedFile) {
      autoFile = sharedFile;
      showScanner = true;
    }
  });

  const hasScan = $derived(scanResult !== null);
  const lowConfidence = $derived(
    scanResult !== null && scanResult.meanConfidence < DEFAULT_CONFIDENCE_THRESHOLD,
  );
  const flaggedCount = $derived(positions.filter((p) => p.is_valid === false).length);

  function onScanned(result: ScanResult): void {
    scanResult = result;
    showScanner = false;
    autoFile = null;
    if (result.parsed.invoiceDate) invoiceDate = result.parsed.invoiceDate;
    if (result.parsed.invoiceNumber) invoiceNumber = result.parsed.invoiceNumber;
    if (result.parsed.providerName) providerName = result.parsed.providerName;
    providerType = defaultProviderType(result.schedule);
    positions = toReviewPositions(result).map((p) => ({
      goae_number: p.goaeNumber,
      goae_category: isAuslagenersatzDescription(p.description)
        ? 'Auslagenersatz'
        : (result.schedule as GoaeCategory),
      quantity: p.quantity,
      treatment_date: p.treatmentDate ?? '',
      description: p.description ?? '',
      multiplier: p.multiplier,
      base_amount: p.baseAmount,
      charged_amount: p.chargedAmount,
      eligible_amount: null,
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
    return 'GOÄ';
  }

  // ---------------------------------------------------------------------------
  // Live recalculation (Faktor/Anzahl/Basis → Betrag → Rechnungsbetrag; Ziffer/
  // Kategorie → Basis) — the debounced auto-revalidation effect further below
  // remains responsible for full re-validation (is_valid/flag_reason) against
  // the fee tables.
  // ---------------------------------------------------------------------------

  function recalcTotal() {
    totalAmount = roundCents(positions.reduce((s, p) => s + (p.charged_amount || 0), 0));
  }

  function recalcChargedAmount(i: number) {
    const pos = positions[i];
    if (!pos) return;
    pos.charged_amount = roundCents(
      (pos.base_amount || 0) * (pos.multiplier || 0) * (pos.quantity || 0),
    );
    recalcTotal();
  }

  async function recalcBaseAmount(i: number) {
    const pos = positions[i];
    if (!pos || pos.goae_category === 'Auslagenersatz' || !pos.goae_number.trim()) return;
    const schedule = categoryToSchedule(pos.goae_category);
    const table = await loadFeeTable(schedule);
    const index = buildIndex(table);
    const entry = index.get(normalizeZiffer(pos.goae_number));
    if (entry?.baseAmount == null) return;
    pos.base_amount = entry.baseAmount;
    recalcChargedAmount(i);
  }

  async function revalidatePositions() {
    if (positions.length === 0) return;
    revalidating = true;
    revalidateError = null;
    try {
      const schedules = new Set(
        positions
          .filter((p) => p.goae_category !== 'Auslagenersatz')
          .map((p) => categoryToSchedule(p.goae_category)),
      );
      const tableEntries = await Promise.all(
        [...schedules].map(async (s) => [s, await loadFeeTable(s)] as const),
      );
      const tables = new Map(tableEntries);
      const indexes = new Map([...tables.entries()].map(([s, t]) => [s, buildIndex(t)]));

      // Collect benefitCategory per position for eligible_amount computation
      // below, and the looked-up ParsedPosition (indexed by row) for the
      // whole-invoice constraint check that follows — Auslagenersatz rows have
      // no Ziffer to check and are left as a hole (skipped by validatePositions).
      const benefitCategories: (BenefitCategory | null)[] = [];
      const parsedByIndex: ParsedPosition[] = [];

      positions.forEach((pos, i) => {
        // §10 GOÄ Auslagenersatz (Porto/Versand etc.) has no Ziffer/Steigerungsfaktor
        // to validate against a fee table — auto-detected (upgrade-only, a manual
        // 'Auslagenersatz' choice is never reverted) or already set by the user.
        if (
          pos.goae_category === 'Auslagenersatz' ||
          isAuslagenersatzDescription(pos.description)
        ) {
          benefitCategories[i] = null;
          return;
        }
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
        benefitCategories[i] = result.benefitCategory;
        parsedByIndex[i] = result;
      });

      // Whole-invoice constraint check (excludes/requires/componentOf/…), rolled
      // into each affected ParsedPosition's isValid/flags by validatePositions —
      // the same channel the §5 per-position checks below use, so a violation
      // persists via is_valid/flag_reason without a separate storage path.
      const { positions: validated } = validatePositions(parsedByIndex, tables, indexes);

      positions = positions.map((pos, i) => {
        if (
          pos.goae_category === 'Auslagenersatz' ||
          isAuslagenersatzDescription(pos.description)
        ) {
          return {
            ...pos,
            goae_category: 'Auslagenersatz' as GoaeCategory,
            is_valid: true,
            flag_reason: null,
          };
        }
        const result = validated[i];
        if (!result) return pos;
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

      // Recalculate eligible_amount per position when the insured person's tariff
      // data is available. Positions with an unknown Ziffer (benefitCategory == null)
      // fall back to 'sonstiges'; the tariff will return 0 for uncovered areas.
      const insuredPerson = insuredOptions.find((o) => o.id === insuredPersonId)?.insuredPerson;
      if (insuredPerson?.included_benefits && insuredPerson.start_date) {
        const erstattungPositions: ErstattungPosition[] = positions.map((pos, i) => ({
          category: (benefitCategories[i] ?? 'sonstiges') as BenefitCategory,
          chargedAmount: pos.charged_amount,
          treatmentDate: pos.treatment_date || invoiceDate,
          isAuslagenersatz: pos.goae_category === 'Auslagenersatz',
        }));
        const result = computeErstattung({
          positions: erstattungPositions,
          benefits: insuredPerson.included_benefits,
          invoiceDate,
          coverageStart: insuredPerson.start_date,
        });
        positions = positions.map((pos, i) => ({
          ...pos,
          eligible_amount: result.byPosition[i]?.eligible_amount ?? null,
        }));
      }
    } catch (e) {
      revalidateError = e instanceof Error ? e.message : 'Neuprüfung fehlgeschlagen.';
    } finally {
      revalidating = false;
    }
  }

  /**
   * Fields that feed `revalidatePositions()`'s lookups: Kategorie (which fee
   * table/schedule applies), Ziffer (the lookup key), Faktor (checked against
   * the §5 limit) and Anzahl (the maxFrequency/maxAmount sums scale with it),
   * plus the insured person and Rechnungsdatum (eligible_amount depends on
   * both). `null` when there are no positions. None of these fields are ever
   * written by `revalidatePositions()` itself — it only writes
   * description/base_amount/is_valid/flag_reason/eligible_amount (and
   * treatment_date when empty) — so re-running it can't change this key and
   * retrigger itself. Deliberately a memoized string (not e.g. `positions`
   * itself or `positions.length` read directly in the effect below): each
   * `revalidatePositions()` run reassigns `positions` to new array references
   * several times even when every tracked field is unchanged, and `$effect`
   * only skips re-running when the value it reads is unchanged — a derived
   * string compares by value, a `$state` array reference never does.
   */
  const revalidationKey = $derived(
    positions.length === 0
      ? null
      : positions
          .map((p) => `${p.goae_category ?? ''}|${p.goae_number}|${p.multiplier}|${p.quantity}`)
          .join(';') + `#${insuredPersonId}#${invoiceDate}`,
  );

  let revalidateTimer: ReturnType<typeof setTimeout> | undefined;

  // Validation is a pure, in-memory lookup against already-loaded fee tables —
  // fast enough to run on every relevant change instead of behind a button;
  // debounced only to collapse a burst of keystrokes (e.g. typing a Faktor)
  // into a single run.
  $effect(() => {
    if (revalidationKey === null) return;
    clearTimeout(revalidateTimer);
    revalidateTimer = setTimeout(() => void revalidatePositions(), 400);
  });
  onDestroy(() => clearTimeout(revalidateTimer));

  // ---------------------------------------------------------------------------
  // Re-parse positions from stored raw OCR (edit mode, status 'neu' only)
  // ---------------------------------------------------------------------------

  const canReparseFromOcr = $derived(
    mode === 'edit' && !!initialData?.ocr_raw && initialData?.status === 'neu',
  );

  let reparsing = $state(false);
  let reparseError = $state<string | null>(null);

  async function reparseFromRawOcr() {
    const rawOcr = initialData?.ocr_raw;
    if (!rawOcr) return;
    reparsing = true;
    reparseError = null;
    try {
      const [goaeTable, gozTable, gotTable] = await Promise.all([
        loadFeeTable('GOÄ'),
        loadFeeTable('GOZ'),
        loadFeeTable('GOT'),
      ]);
      const parsed = parseInvoice(rawOcr, [goaeTable, gozTable, gotTable], {});
      positions = parsed.positions.map((p) => ({
        goae_number: p.ziffer,
        goae_category: isAuslagenersatzDescription(p.description)
          ? 'Auslagenersatz'
          : (p.feeSchedule as GoaeCategory),
        quantity: p.quantity,
        treatment_date: p.treatmentDate ?? '',
        description: p.description ?? '',
        multiplier: p.multiplier,
        base_amount: p.baseAmount ?? 0,
        charged_amount: p.chargedAmount,
        eligible_amount: null,
        is_valid: p.isValid,
        flag_reason: p.flags.length > 0 ? p.flags.map((f) => f.reason).join(' ') : null,
        confidence: 1,
      }));
      if (positions.length > 0) {
        totalAmount = roundCents(positions.reduce((s, p) => s + p.charged_amount, 0));
      }
    } catch (e) {
      reparseError = e instanceof Error ? e.message : 'Neu einlesen fehlgeschlagen.';
    } finally {
      reparsing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Fee schedule info dialog (Ziffer / Kat. lookup)
  // ---------------------------------------------------------------------------

  type InfoEntry = { ziffer: string; schedule: FeeScheduleId; entry: FeeEntry | null };
  let infoDialogOpen = $state(false);
  let infoEntry = $state<InfoEntry | null>(null);
  let infoLoading = $state(false);

  // Only reachable for pos.goae_category !== 'Auslagenersatz' — the info button
  // is hidden alongside the Ziffer field for Auslagenersatz positions.
  async function openFeeInfo(pos: PositionRow) {
    if (!pos.goae_number.trim()) return;
    infoLoading = true;
    infoDialogOpen = true;
    infoEntry = null;
    try {
      const schedule = categoryToSchedule(pos.goae_category);
      const table = await loadFeeTable(schedule);
      const index = buildIndex(table);
      const entry = index.get(normalizeZiffer(pos.goae_number)) ?? null;
      infoEntry = { ziffer: pos.goae_number, schedule, entry };
    } finally {
      infoLoading = false;
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
    const positionInputs: InvoicePositionInput[] = positions.map((p) => {
      // Auslagenersatz has no Ziffer/Steigerungsfaktor/Basis (§10 GOÄ) — the fields
      // stay hidden but keep their last values while editing, so a category change
      // can be undone; only clear them once the position is actually saved.
      const isAuslagenersatz = p.goae_category === 'Auslagenersatz';
      return {
        goae_number: isAuslagenersatz ? '' : p.goae_number,
        goae_category: p.goae_category,
        quantity: p.quantity,
        // Positions without a date fall back to the invoice date (§3.2 Issue #139).
        treatment_date: p.treatment_date || invoiceDate,
        description: p.description.trim() || null,
        multiplier: isAuslagenersatz ? 1 : p.multiplier,
        base_amount: isAuslagenersatz ? 0 : p.base_amount,
        charged_amount: p.charged_amount,
        eligible_amount: p.eligible_amount,
        is_valid: p.is_valid,
        flag_reason: p.flag_reason,
      };
    });

    onSave({
      insured_person_id: insuredPersonId,
      invoice_date: invoiceDate,
      invoice_number: invoiceNumber.trim() || null,
      provider_name: providerName.trim(),
      provider_type: providerType,
      total_amount: totalAmount,
      notes: notes.trim() || null,
      ocr_raw: mode === 'create' && hasScan && saveOcrRaw ? (scanResult?.ocrText ?? null) : null,
      positions: positionInputs,
    });
  }
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
        <OCRScanner bind:schedule={ocrSchedule} {onScanned} {autoFile} />
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
        items={insuredOptions.map((o) => ({ value: o.id, label: o.label }))}
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
        items={providerTypeValues.map((t) => ({ value: t, label: PROVIDER_TYPE_LABELS[t] }))}
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
        {#if canReparseFromOcr}
          <Button
            type="button"
            variant="outline"
            onclick={reparseFromRawOcr}
            disabled={reparsing || disabled}
          >
            <RefreshCcwIcon class="mr-1.5 size-3.5" />
            {reparsing ? 'Wird eingelesen …' : 'Positionen neu einlesen'}
          </Button>
        {/if}
        {#if revalidating}
          <span class="text-xs text-muted-foreground">Wird geprüft …</span>
        {/if}
        <Button type="button" variant="ghost" size="sm" onclick={addPosition} {disabled}>
          + Position hinzufügen
        </Button>
      </div>
    </div>

    {#if reparseError}
      <Alert variant="destructive">
        <AlertDescription>{reparseError}</AlertDescription>
      </Alert>
    {/if}
    {#if revalidateError}
      <Alert variant="destructive">
        <AlertDescription>{revalidateError}</AlertDescription>
      </Alert>
    {/if}

    {#if positions.length > 0}
      <div class="flex flex-col gap-3">
        {#each positions as pos, i (i)}
          <Card class={cn(pos.is_valid === false && 'bg-warning/5')}>
            <CardHeader
              class="flex flex-row items-center justify-between gap-2 border-b border-border pb-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold">Position {i + 1}</span>
                <span class="text-sm text-muted-foreground tabular-nums"
                  >· {formatEur(pos.charged_amount || 0)}</span
                >
              </div>
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
            </CardHeader>
            <CardContent class="flex flex-col gap-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div class="space-y-1.5">
                  <Label for="pos-{i}-datum">
                    Datum <span class="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="pos-{i}-datum"
                    type="date"
                    bind:value={pos.treatment_date}
                    {disabled}
                  />
                </div>
                <div class="space-y-1.5">
                  <Label for="pos-{i}-kategorie">Kategorie</Label>
                  <Select
                    type="single"
                    value={pos.goae_category ?? ''}
                    onValueChange={(v: string) => {
                      pos.goae_category = (v || null) as GoaeCategory | null;
                      void recalcBaseAmount(i);
                    }}
                    {disabled}
                    items={goaeCategoryValues.map((cat) => ({
                      value: cat,
                      label: GOAE_CATEGORY_LABELS[cat] ?? cat,
                    }))}
                  >
                    <SelectTrigger class="w-full" id="pos-{i}-kategorie">
                      <SelectValue placeholder="Kategorie" />
                    </SelectTrigger>
                    <SelectContent>
                      {#each goaeCategoryValues as cat (cat)}
                        <SelectItem value={cat} label={GOAE_CATEGORY_LABELS[cat] ?? cat} />
                      {/each}
                    </SelectContent>
                  </Select>
                </div>
                {#if pos.goae_category !== 'Auslagenersatz'}
                  <div class="space-y-1.5">
                    <Label for="pos-{i}-ziffer">Ziffer</Label>
                    <div class="flex items-center gap-1">
                      <Input
                        id="pos-{i}-ziffer"
                        type="text"
                        bind:value={pos.goae_number}
                        onchange={() => void recalcBaseAmount(i)}
                        placeholder="z.B. 1"
                        required
                        {disabled}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                        title="Gebührenverzeichnis-Eintrag anzeigen"
                        disabled={!pos.goae_number.trim() || infoLoading}
                        onclick={() => openFeeInfo(pos)}
                      >
                        <InfoIcon class="size-3.5" />
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>
              <div class="space-y-1.5">
                <Label for="pos-{i}-beschreibung">Beschreibung</Label>
                <Textarea
                  id="pos-{i}-beschreibung"
                  bind:value={pos.description}
                  placeholder="optional"
                  rows={2}
                  {disabled}
                />
              </div>
              <div
                class={cn(
                  'grid grid-cols-2 gap-3',
                  pos.goae_category !== 'Auslagenersatz' && 'sm:grid-cols-4',
                )}
              >
                {#if pos.goae_category !== 'Auslagenersatz'}
                  <div class="space-y-1.5">
                    <Label for="pos-{i}-faktor">Faktor</Label>
                    <Input
                      id="pos-{i}-faktor"
                      type="number"
                      bind:value={pos.multiplier}
                      oninput={() => recalcChargedAmount(i)}
                      min="0.01"
                      step="0.01"
                      required
                      {disabled}
                      class="text-right"
                    />
                  </div>
                {/if}
                <div class="space-y-1.5">
                  <Label for="pos-{i}-anzahl">Anz.</Label>
                  <Input
                    id="pos-{i}-anzahl"
                    type="number"
                    bind:value={pos.quantity}
                    oninput={() => recalcChargedAmount(i)}
                    min="1"
                    step="1"
                    required
                    {disabled}
                    class="text-right"
                  />
                </div>
                {#if pos.goae_category !== 'Auslagenersatz'}
                  <div class="space-y-1.5">
                    <Label for="pos-{i}-basis">Basis (€)</Label>
                    <Input
                      id="pos-{i}-basis"
                      type="number"
                      bind:value={pos.base_amount}
                      oninput={() => recalcChargedAmount(i)}
                      min="0"
                      step="0.01"
                      required
                      {disabled}
                      class="text-right"
                    />
                  </div>
                {/if}
                <div class="space-y-1.5">
                  <Label for="pos-{i}-betrag">Betrag (€)</Label>
                  <Input
                    id="pos-{i}-betrag"
                    type="number"
                    bind:value={pos.charged_amount}
                    oninput={recalcTotal}
                    min="0"
                    step="0.01"
                    required
                    {disabled}
                    class="text-right"
                  />
                </div>
              </div>
              {#if pos.is_valid === false && pos.flag_reason}
                <p class="text-xs text-warning">
                  ⚠ {pos.flag_reason}
                </p>
              {/if}
              {#if pos.confidence < DEFAULT_CONFIDENCE_THRESHOLD}
                <p class="text-xs italic text-muted-foreground">
                  Unsichere Erkennung – bitte prüfen.
                </p>
              {/if}
            </CardContent>
          </Card>
        {/each}
      </div>
    {:else}
      <p class="text-sm text-muted-foreground">Noch keine Positionen. Positionen sind optional.</p>
    {/if}
  </div>

  <!-- OCR opt-in checkbox (create mode only, after a scan) -->
  {#if mode === 'create' && hasScan}
    <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
      <input type="checkbox" bind:checked={saveOcrRaw} class="rounded border-border" />
      <span>OCR-Rohtext speichern (ermöglicht späteres Neu-Einlesen; abwählen zum Verwerfen)</span>
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

<!-- Fee schedule entry info dialog -->
<DialogRoot bind:open={infoDialogOpen}>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>
        {#if infoEntry}
          {infoEntry.schedule} {infoEntry.ziffer}
        {:else if infoLoading}
          Wird geladen …
        {:else}
          Gebührenverzeichnis
        {/if}
      </DialogTitle>
    </DialogHeader>
    {#if infoLoading}
      <p class="text-sm text-muted-foreground">Eintrag wird geladen …</p>
    {:else if infoEntry?.entry}
      {@const entry = infoEntry.entry}
      <div class="flex flex-col gap-3 text-sm">
        <p class="font-medium leading-snug">{entry.description}</p>
        {#if entry.notes && entry.notes.length > 0}
          <div
            class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            <p class="mb-1 font-semibold uppercase tracking-wide text-foreground/60">Hinweise</p>
            {#each entry.notes as note (note)}
              <p>{note}</p>
            {/each}
          </div>
        {/if}
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt class="text-muted-foreground">Kategorie</dt>
          <dd>{entry.category}</dd>
          {#if entry.baseAmount != null}
            <dt class="text-muted-foreground">Basis (1,0×)</dt>
            <dd>{formatEur(entry.baseAmount)}</dd>
          {/if}
          <dt class="text-muted-foreground">Max. Faktor</dt>
          <dd>{entry.maxMultiplier ?? '—'}</dd>
        </dl>
      </div>
    {:else if infoEntry}
      <p class="text-sm text-muted-foreground">
        Ziffer <strong>{infoEntry.ziffer}</strong> ist im {infoEntry.schedule}-Verzeichnis nicht
        bekannt.
      </p>
    {/if}
  </DialogContent>
</DialogRoot>
