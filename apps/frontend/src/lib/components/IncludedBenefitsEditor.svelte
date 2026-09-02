<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Editor for `insured_persons.included_benefits` (§5.5) — the per-Leistungsbereich
  tariff rules the Erstattungs-Engine (§8.4) evaluates: Erstattungsstaffel
  (`tiers`), Summengrenzen (`limits`), Aufbaujahre (`annual_staffel`), Wartezeit
  and Beihilfe-Satz.

  Extracted from `routes/contracts/[id]/+page.svelte` (issues #445/#465). Two
  things it does that the inline version did not: the three ladders are
  `RepeaterTable`s (real table semantics, undoable row removal), and validation
  runs through `includedBenefitsSchema.safeParse` so every Zod issue lands on the
  field its `path` points at instead of collapsing into one page-level message.

  `value` is read once, at construction — the component owns its editing state
  afterwards and reports upwards through `onchange`. Mount it under a `{#key}` to
  edit a different insured person.
-->
<script lang="ts">
  import {
    BENEFIT_CATEGORY_LABELS,
    benefitCategoryValues,
    benefitLimitScopeValues,
    includedBenefitsSchema,
    type BenefitCategory,
    type BenefitLimitScope,
    type IncludedBenefits,
  } from '@selbstbehalt/shared';
  import { toast } from 'svelte-sonner';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { Button } from '@selbstbehalt/ui/button';
  import { Input } from '@selbstbehalt/ui/input';
  import { Label } from '@selbstbehalt/ui/label';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@selbstbehalt/ui/select';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import RepeaterTable, { type RepeaterColumn } from './RepeaterTable.svelte';

  type Props = {
    /** Initial value; read once at construction. `null` = nothing configured. */
    value: IncludedBenefits | null;
    /**
     * Reports the current value (`null` while nothing is configured or the
     * configuration does not validate) together with its validity.
     */
    onchange: (value: IncludedBenefits | null, valid: boolean) => void;
    disabled?: boolean;
    /** Prefix for the generated element `id`s — unique per page. */
    idPrefix?: string;
  };

  let { value, onchange, disabled = false, idPrefix = 'benefits' }: Props = $props();

  const BENEFIT_LIMIT_SCOPE_LABELS: Record<BenefitLimitScope, string> = {
    behandlung: 'Je Behandlungsfall',
    jahr: 'Pro Kalenderjahr',
    lebenslang: 'Lebenslang',
  };

  type UiTier = { up_to: number | undefined; pct: number | undefined };
  type UiLimit = {
    scope: BenefitLimitScope;
    max_amount: number | undefined;
    age_min: number | undefined;
    age_max: number | undefined;
  };
  type UiStaffelEntry = { policy_year: number | undefined; cumulative_cap: number | undefined };
  type UiBenefit = {
    category: BenefitCategory;
    waiting_period_months: number | undefined;
    beihilfe_satz: number | undefined;
    hasTiers: boolean;
    tiers: UiTier[];
    hasLimits: boolean;
    limits: UiLimit[];
    hasStaffel: boolean;
    annual_staffel: UiStaffelEntry[];
  };

  function toUi(benefits: IncludedBenefits): UiBenefit[] {
    return benefits.benefits.map((b) => ({
      category: b.category,
      waiting_period_months: b.waiting_period_months,
      beihilfe_satz: b.beihilfe_satz,
      hasTiers: !!b.tiers && b.tiers.length > 0,
      tiers: b.tiers
        ? b.tiers.map((t) => ({ up_to: t.up_to ?? undefined, pct: t.pct }))
        : [{ up_to: 1000, pct: 100 }],
      hasLimits: !!b.limits && b.limits.length > 0,
      limits: (b.limits ?? []).map((l) => ({
        scope: l.scope,
        max_amount: l.max_amount ?? undefined,
        age_min: l.age_min,
        age_max: l.age_max,
      })),
      hasStaffel: !!b.annual_staffel && b.annual_staffel.length > 0,
      annual_staffel: (b.annual_staffel ?? []).map((e) => ({
        policy_year: e.policy_year,
        cumulative_cap: e.cumulative_cap ?? undefined,
      })),
    }));
  }

  // Read once on purpose: from here on the component owns the editing state and
  // reports upwards through `onchange` (see the component comment).
  // svelte-ignore state_referenced_locally
  const initial = value;

  let enabled = $state(initial !== null);
  let benefits = $state<UiBenefit[]>(initial ? toUi(initial) : []);
  let container = $state<HTMLDivElement | null>(null);

  /** Number inputs yield `null` when cleared — normalise everything unusable away. */
  function optionalNumber(input: unknown): number | undefined {
    return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
  }

  function defaultBenefit(): UiBenefit {
    return {
      category: 'ambulant',
      waiting_period_months: undefined,
      beihilfe_satz: undefined,
      hasTiers: false,
      tiers: [{ up_to: 1000, pct: 100 }],
      hasLimits: false,
      limits: [],
      hasStaffel: false,
      annual_staffel: [],
    };
  }

  /**
   * The `included_benefits` payload as typed into the form — not yet validated,
   * so it is fed through `safeParse` rather than `parse`. The trailing tier is
   * the open-ended one (`up_to: null`), which is what the schema's ladder
   * validation expects.
   */
  function buildRaw(): unknown {
    return {
      benefits: benefits.map((b) => {
        const benefit: Record<string, unknown> = { category: b.category };
        const waiting = optionalNumber(b.waiting_period_months);
        if (waiting !== undefined) benefit['waiting_period_months'] = waiting;
        const beihilfe = optionalNumber(b.beihilfe_satz);
        if (beihilfe !== undefined) benefit['beihilfe_satz'] = beihilfe;
        if (b.hasTiers && b.tiers.length > 0) {
          benefit['tiers'] = b.tiers.map((t, idx) => ({
            pct: optionalNumber(t.pct) ?? null,
            up_to: idx === b.tiers.length - 1 ? null : (optionalNumber(t.up_to) ?? null),
          }));
        }
        if (b.hasLimits && b.limits.length > 0) {
          benefit['limits'] = b.limits.map((l) => {
            const limit: Record<string, unknown> = {
              scope: l.scope,
              max_amount: optionalNumber(l.max_amount) ?? null,
            };
            const ageMin = optionalNumber(l.age_min);
            if (ageMin !== undefined) limit['age_min'] = ageMin;
            const ageMax = optionalNumber(l.age_max);
            if (ageMax !== undefined) limit['age_max'] = ageMax;
            return limit;
          });
        }
        if (b.hasStaffel && b.annual_staffel.length > 0) {
          benefit['annual_staffel'] = b.annual_staffel.map((e) => ({
            policy_year: optionalNumber(e.policy_year) ?? null,
            cumulative_cap: optionalNumber(e.cumulative_cap) ?? null,
          }));
        }
        return benefit;
      }),
    };
  }

  const parsed = $derived(
    enabled && benefits.length > 0 ? includedBenefitsSchema.safeParse(buildRaw()) : null,
  );
  const issues = $derived(parsed && !parsed.success ? parsed.error.issues : []);

  $effect(() => {
    if (!parsed) {
      onchange(null, true);
    } else {
      onchange(parsed.success ? parsed.data : null, parsed.success);
    }
  });

  /** The first Zod message registered exactly at `path`, if any. */
  function messageAt(...path: (string | number)[]): string | undefined {
    const key = path.join('.');
    return issues.find((issue) => issue.path.join('.') === key)?.message;
  }

  /**
   * Moves focus to the first field the schema rejected. Called by the embedding
   * form on submit; returns whether there was anything to focus.
   */
  export function focusFirstInvalid(): boolean {
    const invalid = container?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!invalid) return false;
    invalid.focus();
    return true;
  }

  function addBenefit() {
    benefits.push(defaultBenefit());
  }

  function removeBenefit(index: number) {
    const [removed] = benefits.splice(index, 1);
    toast('Leistungsbereich entfernt', {
      action: {
        label: 'Rückgängig',
        onClick: () => {
          if (removed) benefits.splice(index, 0, removed);
        },
      },
    });
  }

  const TIER_COLUMNS: RepeaterColumn[] = [
    { key: 'up-to', label: 'Bis (€)' },
    { key: 'pct', label: 'Erstattung (%)' },
  ];

  const LIMIT_COLUMNS: RepeaterColumn[] = [
    { key: 'scope', label: 'Zeitraum' },
    { key: 'max', label: 'Höchstbetrag (€)' },
    { key: 'age-min', label: 'Alter von' },
    { key: 'age-max', label: 'Alter bis' },
  ];

  const STAFFEL_COLUMNS: RepeaterColumn[] = [
    { key: 'year', label: 'Versicherungsjahr' },
    { key: 'cap', label: 'Kum. Höchstbetrag (€)' },
  ];

  function addTier(benefitIdx: number) {
    const tiers = benefits[benefitIdx]!.tiers;
    const prevUpTo = tiers.length >= 2 ? (optionalNumber(tiers[tiers.length - 2]!.up_to) ?? 0) : 0;
    tiers.splice(tiers.length - 1, 0, { up_to: prevUpTo + 500, pct: 100 });
  }

  function addLimit(benefitIdx: number) {
    benefits[benefitIdx]!.limits.push({
      scope: 'jahr',
      max_amount: undefined,
      age_min: undefined,
      age_max: undefined,
    });
  }

  function addStaffelEntry(benefitIdx: number) {
    const staffel = benefits[benefitIdx]!.annual_staffel;
    const nextYear = (optionalNumber(staffel[staffel.length - 1]?.policy_year) ?? 0) + 1;
    staffel.push({ policy_year: nextYear, cumulative_cap: undefined });
  }
</script>

<div
  bind:this={container}
  class="space-y-3 rounded-md border border-border bg-muted/30 p-3"
  data-testid="included-benefits-editor"
>
  <div class="flex items-center gap-2">
    <Checkbox
      id="{idPrefix}-enabled"
      bind:checked={enabled}
      {disabled}
      aria-controls="{idPrefix}-list"
    />
    <Label for="{idPrefix}-enabled">Enthaltene Leistungen konfigurieren</Label>
  </div>

  {#if enabled}
    <div id="{idPrefix}-list" class="space-y-3">
      {#if benefits.length === 0}
        <p class="text-sm text-muted-foreground">Noch kein Leistungsbereich hinzugefügt.</p>
      {/if}

      {#each benefits as benefit, i (i)}
        {@const prefix = `${idPrefix}-b${i}`}
        {@const waitingError = messageAt('benefits', i, 'waiting_period_months')}
        {@const beihilfeError = messageAt('benefits', i, 'beihilfe_satz')}
        <div class="space-y-3 rounded-md border border-border bg-card p-3">
          <div class="flex flex-wrap items-end gap-3">
            <div class="min-w-40 flex-1 space-y-1">
              <Label for="{prefix}-category">Leistungsbereich</Label>
              <Select
                type="single"
                value={benefit.category}
                onValueChange={(v: string) => {
                  if (v) benefit.category = v as BenefitCategory;
                }}
                {disabled}
                items={benefitCategoryValues.map((cat) => ({
                  value: cat,
                  label: BENEFIT_CATEGORY_LABELS[cat],
                }))}
              >
                <SelectTrigger id="{prefix}-category" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {#each benefitCategoryValues as cat (cat)}
                    <SelectItem value={cat} label={BENEFIT_CATEGORY_LABELS[cat]} />
                  {/each}
                </SelectContent>
              </Select>
            </div>
            <div class="w-32 space-y-1">
              <Label for="{prefix}-waiting">Wartezeit (Monate)</Label>
              <Input
                id="{prefix}-waiting"
                type="number"
                bind:value={benefit.waiting_period_months}
                min="0"
                step="1"
                placeholder="keine"
                {disabled}
                aria-invalid={waitingError ? 'true' : undefined}
                aria-describedby={waitingError ? `${prefix}-waiting-error` : undefined}
              />
              {#if waitingError}
                <p id="{prefix}-waiting-error" class="text-destructive text-xs">{waitingError}</p>
              {/if}
            </div>
            <div class="w-32 space-y-1">
              <Label for="{prefix}-beihilfe">Beihilfe-Satz (%)</Label>
              <Input
                id="{prefix}-beihilfe"
                type="number"
                bind:value={benefit.beihilfe_satz}
                min="0"
                max="100"
                step="1"
                placeholder="–"
                {disabled}
                aria-invalid={beihilfeError ? 'true' : undefined}
                aria-describedby={beihilfeError ? `${prefix}-beihilfe-error` : undefined}
              />
              {#if beihilfeError}
                <p id="{prefix}-beihilfe-error" class="text-destructive text-xs">{beihilfeError}</p>
              {/if}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Leistungsbereich {BENEFIT_CATEGORY_LABELS[benefit.category]} entfernen"
              {disabled}
              onclick={() => removeBenefit(i)}
            >
              <Trash2Icon class="size-4" />
            </Button>
          </div>

          <!-- Erstattungsstaffel -->
          <div class="space-y-2 border-l-2 border-border pl-3">
            <div class="flex items-center gap-2">
              <Checkbox id="{prefix}-has-tiers" bind:checked={benefit.hasTiers} {disabled} />
              <Label for="{prefix}-has-tiers">Erstattungsstaffel</Label>
            </div>
            {#if benefit.hasTiers}
              {@const ladderError = messageAt('benefits', i, 'tiers')}
              {#if ladderError}
                <p class="text-destructive text-xs">{ladderError}</p>
              {/if}
              <RepeaterTable
                caption="Erstattungsstaffel für {BENEFIT_CATEGORY_LABELS[benefit.category]}"
                columns={TIER_COLUMNS}
                rows={benefit.tiers}
                idPrefix="{prefix}-tier"
                addLabel="Stufe hinzufügen"
                {disabled}
                removeLabel={() => 'Stufe entfernen'}
                canRemove={(_row, j) => j < benefit.tiers.length - 1}
                onAdd={() => addTier(i)}
                onRemove={(j) => benefit.tiers.splice(j, 1)}
                onRestore={(j, row) => benefit.tiers.splice(j, 0, row)}
              >
                {#snippet cell({ row, index: j, column, headerId })}
                  {#if column.key === 'up-to'}
                    {#if j < benefit.tiers.length - 1}
                      {@const error = messageAt('benefits', i, 'tiers', j, 'up_to')}
                      <Input
                        type="number"
                        bind:value={row.up_to}
                        min="0.01"
                        step="0.01"
                        aria-labelledby={headerId}
                        {disabled}
                        aria-invalid={error ? 'true' : undefined}
                        aria-describedby={error ? `${prefix}-tier-${j}-up-to-error` : undefined}
                      />
                      {#if error}
                        <p id="{prefix}-tier-{j}-up-to-error" class="text-destructive text-xs">
                          {error}
                        </p>
                      {/if}
                    {:else}
                      <span class="text-sm text-muted-foreground italic">Unbegrenzt</span>
                    {/if}
                  {:else}
                    {@const error = messageAt('benefits', i, 'tiers', j, 'pct')}
                    <Input
                      type="number"
                      bind:value={row.pct}
                      min="0"
                      max="100"
                      step="1"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-tier-${j}-pct-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-tier-{j}-pct-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {/if}
                {/snippet}
              </RepeaterTable>
            {/if}
          </div>

          <!-- Summengrenzen -->
          <div class="space-y-2 border-l-2 border-border pl-3">
            <div class="flex items-center gap-2">
              <Checkbox id="{prefix}-has-limits" bind:checked={benefit.hasLimits} {disabled} />
              <Label for="{prefix}-has-limits">Summengrenzen</Label>
            </div>
            {#if benefit.hasLimits}
              <RepeaterTable
                caption="Summengrenzen für {BENEFIT_CATEGORY_LABELS[benefit.category]}"
                columns={LIMIT_COLUMNS}
                rows={benefit.limits}
                idPrefix="{prefix}-limit"
                addLabel="Grenze hinzufügen"
                {disabled}
                removeLabel={() => 'Grenze entfernen'}
                onAdd={() => addLimit(i)}
                onRemove={(j) => benefit.limits.splice(j, 1)}
                onRestore={(j, row) => benefit.limits.splice(j, 0, row)}
              >
                {#snippet cell({ row, index: j, column, headerId })}
                  {#if column.key === 'scope'}
                    <Select
                      type="single"
                      value={row.scope}
                      onValueChange={(v: string) => {
                        if (v) row.scope = v as BenefitLimitScope;
                      }}
                      {disabled}
                      items={benefitLimitScopeValues.map((s) => ({
                        value: s,
                        label: BENEFIT_LIMIT_SCOPE_LABELS[s],
                      }))}
                    >
                      <SelectTrigger class="w-full" aria-labelledby={headerId}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {#each benefitLimitScopeValues as s (s)}
                          <SelectItem value={s} label={BENEFIT_LIMIT_SCOPE_LABELS[s]} />
                        {/each}
                      </SelectContent>
                    </Select>
                  {:else if column.key === 'max'}
                    {@const error = messageAt('benefits', i, 'limits', j, 'max_amount')}
                    <Input
                      type="number"
                      bind:value={row.max_amount}
                      min="0"
                      step="0.01"
                      placeholder="unbegrenzt"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-limit-${j}-max-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-limit-{j}-max-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {:else if column.key === 'age-min'}
                    {@const error = messageAt('benefits', i, 'limits', j, 'age_min')}
                    <Input
                      type="number"
                      bind:value={row.age_min}
                      min="0"
                      step="1"
                      placeholder="–"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-limit-${j}-age-min-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-limit-{j}-age-min-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {:else}
                    {@const error = messageAt('benefits', i, 'limits', j, 'age_max')}
                    <Input
                      type="number"
                      bind:value={row.age_max}
                      min="0"
                      step="1"
                      placeholder="–"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-limit-${j}-age-max-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-limit-{j}-age-max-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {/if}
                {/snippet}
              </RepeaterTable>
            {/if}
          </div>

          <!-- Aufbaujahre (Zahnstaffel) -->
          <div class="space-y-2 border-l-2 border-border pl-3">
            <div class="flex items-center gap-2">
              <Checkbox id="{prefix}-has-staffel" bind:checked={benefit.hasStaffel} {disabled} />
              <Label for="{prefix}-has-staffel">Aufbaujahre (Zahnstaffel)</Label>
            </div>
            {#if benefit.hasStaffel}
              <RepeaterTable
                caption="Aufbaujahre für {BENEFIT_CATEGORY_LABELS[benefit.category]}"
                columns={STAFFEL_COLUMNS}
                rows={benefit.annual_staffel}
                idPrefix="{prefix}-staffel"
                addLabel="Jahr hinzufügen"
                {disabled}
                removeLabel={() => 'Jahr entfernen'}
                onAdd={() => addStaffelEntry(i)}
                onRemove={(j) => benefit.annual_staffel.splice(j, 1)}
                onRestore={(j, row) => benefit.annual_staffel.splice(j, 0, row)}
              >
                {#snippet cell({ row, index: j, column, headerId })}
                  {#if column.key === 'year'}
                    {@const error = messageAt('benefits', i, 'annual_staffel', j, 'policy_year')}
                    <Input
                      type="number"
                      bind:value={row.policy_year}
                      min="1"
                      step="1"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-staffel-${j}-year-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-staffel-{j}-year-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {:else}
                    {@const error = messageAt('benefits', i, 'annual_staffel', j, 'cumulative_cap')}
                    <Input
                      type="number"
                      bind:value={row.cumulative_cap}
                      min="0"
                      step="0.01"
                      placeholder="unbegrenzt"
                      aria-labelledby={headerId}
                      {disabled}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${prefix}-staffel-${j}-cap-error` : undefined}
                    />
                    {#if error}
                      <p id="{prefix}-staffel-{j}-cap-error" class="text-destructive text-xs">
                        {error}
                      </p>
                    {/if}
                  {/if}
                {/snippet}
              </RepeaterTable>
            {/if}
          </div>
        </div>
      {/each}

      <Button type="button" variant="link" class="h-auto px-0" {disabled} onclick={addBenefit}>
        <PlusIcon class="size-4" />
        Leistungsbereich hinzufügen
      </Button>
    </div>
  {/if}
</div>
