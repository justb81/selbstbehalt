<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Create/edit form for one `insured_persons` row (§5.5): the person it belongs
  to, its tariff data (Tarifname, Monatsbeitrag, Selbstbehalt), the BRE-Staffel
  and — through `IncludedBenefitsEditor` — the enthaltene Leistungen.

  Extracted from `routes/contracts/[id]/+page.svelte` (issues #445/#465), which
  keeps only loading, the list and the delete dialogs. All fields are labelled
  (`Label for` + `id`), the BRE ladder is a `RepeaterTable` and the first field
  takes focus on mount.

  Props are read once, at construction — mount the form under a `{#key}` to edit
  a different insured person.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    type BRELevel,
    type BREStructure,
    type IncludedBenefits,
    type InsuredPerson,
    type Person,
  } from '@selbstbehalt/shared';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
  import { Button } from '@selbstbehalt/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '@selbstbehalt/ui/card';
  import { Input } from '@selbstbehalt/ui/input';
  import { Label } from '@selbstbehalt/ui/label';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '@selbstbehalt/ui/select';
  import { Textarea } from '@selbstbehalt/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import IncludedBenefitsEditor from './IncludedBenefitsEditor.svelte';
  import RepeaterTable, { type RepeaterColumn } from './RepeaterTable.svelte';

  type Props = {
    contractId: string;
    /** The row being edited, or `null` for a new insured person. */
    insured: InsuredPerson | null;
    /** The persons selectable as the insured one. */
    persons: Person[];
    onsaved: (insured: InsuredPerson) => void;
    oncancel: () => void;
  };

  let { contractId, insured, persons, onsaved, oncancel }: Props = $props();

  /** One BRE ladder step as typed into the form (§8.3: percent-of-premium or fixed EUR). */
  type BreLevelForm = {
    claim_free_years: number | undefined;
    unit: 'pct' | 'eur';
    bre_years: number | undefined;
    pct_of_premium: number | undefined;
    fixed_amount_eur: number | undefined;
  };

  function defaultBreLevel(claimFreeYears = 1): BreLevelForm {
    return {
      claim_free_years: claimFreeYears,
      unit: 'pct',
      bre_years: 1,
      pct_of_premium: 100,
      fixed_amount_eur: 0,
    };
  }

  // Read once on purpose — the form owns its fields once it is mounted.
  // svelte-ignore state_referenced_locally
  const initial = insured;

  let personId = $state(initial?.person_id ?? '');
  let kvnr = $state(initial?.kvnr ?? '');
  let tariffName = $state(initial?.tariff_name ?? '');
  let monthlyPremium = $state<number | undefined>(initial?.monthly_premium ?? 0);
  let selfRetention = $state<number | undefined>(initial?.self_retention ?? 0);
  let startDate = $state(initial?.start_date ?? '');
  let endDate = $state(initial?.end_date ?? '');
  let notes = $state(initial?.notes ?? '');

  let hasBre = $state(initial?.bre_structure != null);
  let streakStart = $state(initial?.bre_structure?.current_streak_start ?? '');
  let breLevels = $state<BreLevelForm[]>(
    initial?.bre_structure
      ? initial.bre_structure.levels.map((l) => ({
          claim_free_years: l.claim_free_years,
          unit: l.fixed_amount_eur !== undefined ? ('eur' as const) : ('pct' as const),
          bre_years: l.bre_years ?? 1,
          pct_of_premium: l.pct_of_premium ?? 100,
          fixed_amount_eur: l.fixed_amount_eur ?? 0,
        }))
      : [defaultBreLevel()],
  );

  let includedBenefits = $state<IncludedBenefits | null>(initial?.included_benefits ?? null);
  let includedBenefitsValid = $state(true);
  let benefitsEditor = $state<ReturnType<typeof IncludedBenefitsEditor> | null>(null);

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let personTrigger = $state<HTMLElement | null>(null);

  // The form opens at the very end of the page — move focus into it so keyboard
  // and screen-reader users are not left behind at the "hinzufügen" button.
  onMount(() => {
    void tick().then(() => personTrigger?.focus());
  });

  const personOptions = $derived(persons.map((p) => ({ value: p.id, label: p.name })));

  const BRE_COLUMNS: RepeaterColumn[] = [
    { key: 'years', label: 'Leistungsfreie Jahre' },
    { key: 'unit', label: 'Art' },
    { key: 'refund', label: 'Rückerstattung' },
  ];

  const BRE_UNIT_LABELS: Record<BreLevelForm['unit'], string> = {
    pct: '% × Monate',
    eur: 'Fixer €-Betrag',
  };

  function addBreLevel() {
    const last = breLevels[breLevels.length - 1]?.claim_free_years ?? 0;
    breLevels.push(defaultBreLevel(last + 1));
  }

  function buildBreStructure(): BREStructure | null {
    if (!hasBre) return null;
    return {
      type: 'staffel',
      levels: breLevels.map((l): BRELevel =>
        l.unit === 'eur'
          ? {
              claim_free_years: l.claim_free_years ?? 0,
              fixed_amount_eur: l.fixed_amount_eur ?? 0,
            }
          : {
              claim_free_years: l.claim_free_years ?? 0,
              bre_years: l.bre_years ?? 0,
              pct_of_premium: l.pct_of_premium ?? 0,
            },
      ),
      current_streak_start: streakStart || null,
    };
  }

  async function save() {
    if (!personId) {
      saveError = 'Bitte eine Person auswählen.';
      personTrigger?.focus();
      return;
    }
    if (!(monthlyPremium !== undefined && monthlyPremium > 0)) {
      saveError = 'Bitte einen Monatsbeitrag (> 0) eingeben.';
      return;
    }
    if (!includedBenefitsValid) {
      saveError = 'Leistungskonfiguration ist ungültig. Bitte die markierten Felder prüfen.';
      benefitsEditor?.focusFirstInvalid();
      return;
    }

    const body = {
      person_id: personId,
      kvnr: kvnr.trim() || null,
      tariff_name: tariffName.trim() || null,
      monthly_premium: monthlyPremium,
      self_retention: selfRetention ?? 0,
      bre_structure: buildBreStructure(),
      included_benefits: includedBenefits,
      start_date: startDate.trim() || null,
      end_date: endDate.trim() || null,
      notes: notes.trim() || null,
    };

    saving = true;
    saveError = null;
    try {
      const saved = insured
        ? await api.insured.update(insured.id, body)
        : await api.insured.create(contractId, body);
      onsaved(saved);
    } catch (e) {
      saveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      saving = false;
    }
  }
</script>

<Card class="border-primary border-2">
  <CardHeader>
    <CardTitle class="text-base">
      {insured ? 'Versicherte Person bearbeiten' : 'Neue versicherte Person'}
    </CardTitle>
  </CardHeader>
  <CardContent>
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="space-y-1">
          <Label for="ip-person">Person <span class="text-destructive">*</span></Label>
          <Select
            type="single"
            value={personId}
            onValueChange={(v: string) => {
              if (v) personId = v;
            }}
            items={personOptions}
          >
            <SelectTrigger id="ip-person" class="w-full" bind:ref={personTrigger}>
              <SelectValue placeholder="Bitte wählen …" />
            </SelectTrigger>
            <SelectContent>
              {#each persons as person (person.id)}
                <SelectItem value={person.id} label={person.name} />
              {/each}
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1">
          <Label for="ip-kvnr">KVNR</Label>
          <Input id="ip-kvnr" type="text" bind:value={kvnr} placeholder="optional" />
        </div>

        <div class="space-y-1">
          <Label for="ip-tariff">Tarifname</Label>
          <Input id="ip-tariff" type="text" bind:value={tariffName} placeholder="optional" />
        </div>

        <div class="space-y-1">
          <Label for="ip-premium">Monatsbeitrag (€) <span class="text-destructive">*</span></Label>
          <Input
            id="ip-premium"
            type="number"
            bind:value={monthlyPremium}
            min="0"
            step="0.01"
            required
          />
        </div>

        <div class="space-y-1">
          <Label for="ip-self-retention">Jährlicher Selbstbehalt (€)</Label>
          <Input
            id="ip-self-retention"
            type="number"
            bind:value={selfRetention}
            min="0"
            step="0.01"
          />
        </div>

        <div class="space-y-1">
          <Label for="ip-start">Tarifbeginn</Label>
          <Input id="ip-start" type="date" bind:value={startDate} />
        </div>

        <div class="space-y-1">
          <Label for="ip-end">Tarifende</Label>
          <Input id="ip-end" type="date" bind:value={endDate} />
        </div>
      </div>

      <div class="space-y-1">
        <Label for="ip-notes">Notizen</Label>
        <Textarea id="ip-notes" bind:value={notes} rows={2} />
      </div>

      <!-- BRE-Staffel (§8.3) -->
      <div class="space-y-3 rounded-md border border-border bg-muted/30 p-3">
        <div class="flex items-center gap-2">
          <Checkbox
            id="ip-has-bre"
            bind:checked={hasBre}
            aria-labelledby="ip-has-bre-label"
            aria-controls="ip-bre"
          />
          <Label id="ip-has-bre-label" for="ip-has-bre" class="cursor-pointer font-normal">
            BRE-Staffel konfigurieren
          </Label>
        </div>

        {#if hasBre}
          <div id="ip-bre" class="space-y-3">
            <div class="space-y-1">
              <Label for="ip-streak-start">Leistungsfreiheit begann am</Label>
              <Input id="ip-streak-start" type="date" bind:value={streakStart} class="max-w-xs" />
            </div>

            <RepeaterTable
              caption="Stufen der Beitragsrückerstattung"
              columns={BRE_COLUMNS}
              rows={breLevels}
              idPrefix="ip-bre"
              addLabel="Stufe hinzufügen"
              removeLabel={() => 'Stufe entfernen'}
              canRemove={() => breLevels.length > 1}
              onAdd={addBreLevel}
              onRemove={(i) => breLevels.splice(i, 1)}
              onRestore={(i, row) => breLevels.splice(i, 0, row)}
            >
              {#snippet cell({ row, index: i, column, headerId })}
                {#if column.key === 'years'}
                  <Input
                    type="number"
                    bind:value={row.claim_free_years}
                    min="1"
                    step="1"
                    required
                    aria-labelledby={headerId}
                  />
                {:else if column.key === 'unit'}
                  <Select
                    type="single"
                    value={row.unit}
                    onValueChange={(v: string) => {
                      if (v) row.unit = v as BreLevelForm['unit'];
                    }}
                    items={(['pct', 'eur'] as const).map((u) => ({
                      value: u,
                      label: BRE_UNIT_LABELS[u],
                    }))}
                  >
                    <SelectTrigger class="w-full" aria-labelledby={headerId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pct" label={BRE_UNIT_LABELS.pct} />
                      <SelectItem value="eur" label={BRE_UNIT_LABELS.eur} />
                    </SelectContent>
                  </Select>
                {:else if row.unit === 'pct'}
                  <span class="flex min-w-0 items-center gap-1">
                    <Input
                      type="number"
                      bind:value={row.bre_years}
                      min="0"
                      step="0.5"
                      required
                      class="w-20 flex-shrink-0"
                      aria-label="Stufe {i + 1}: Anzahl Monatsbeiträge"
                    />
                    <span class="text-xs whitespace-nowrap text-muted-foreground">×</span>
                    <Input
                      type="number"
                      bind:value={row.pct_of_premium}
                      min="0"
                      max="100"
                      step="1"
                      required
                      class="w-20 flex-shrink-0"
                      aria-label="Stufe {i + 1}: Anteil am Monatsbeitrag (%)"
                    />
                    <span class="text-xs whitespace-nowrap text-muted-foreground">%</span>
                  </span>
                {:else}
                  <span class="flex min-w-0 items-center gap-1">
                    <Input
                      type="number"
                      bind:value={row.fixed_amount_eur}
                      min="0"
                      step="0.01"
                      required
                      class="w-28 flex-shrink-0"
                      aria-label="Stufe {i + 1}: Fixer Rückerstattungsbetrag (€)"
                    />
                    <span class="text-xs whitespace-nowrap text-muted-foreground">€</span>
                  </span>
                {/if}
              {/snippet}
            </RepeaterTable>
          </div>
        {/if}
      </div>

      <IncludedBenefitsEditor
        bind:this={benefitsEditor}
        value={initial?.included_benefits ?? null}
        idPrefix="ip-benefits"
        onchange={(value, valid) => {
          includedBenefits = value;
          includedBenefitsValid = valid;
        }}
      />

      {#if saveError}
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      {/if}

      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Wird gespeichert …' : insured ? 'Speichern' : 'Hinzufügen'}
        </Button>
        <Button type="button" variant="outline" onclick={oncancel}>Abbrechen</Button>
      </div>
    </form>
  </CardContent>
</Card>
