<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Contract detail (docs/design.md §6.1, issue #21): shows contract info,
  manages insured persons, and renders a BRETracker per person.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api';
  import {
    contractTypeValues,
    benefitCategoryValues,
    benefitLimitScopeValues,
    includedBenefitsSchema,
    formatEur,
    type BRELevel,
    type BREStructure,
    type BenefitCategory,
    type BenefitLimitScope,
    type IncludedBenefits,
    type Contract,
    type ContractType,
    type InsuredPerson,
    type Person,
  } from '@selbstbehalt/shared';
  import BRETracker from '$lib/components/BRETracker.svelte';
  import LoadingState from '$lib/components/LoadingState.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  const TYPE_LABELS: Record<ContractType, string> = {
    vollversicherung: 'Vollversicherung',
    zusatztarif: 'Zusatztarif',
    beihilfe: 'Beihilfe',
  };

  const BENEFIT_CATEGORY_LABELS: Record<BenefitCategory, string> = {
    ambulant: 'Ambulant',
    stationaer: 'Stationär',
    zahnbehandlung: 'Zahnbehandlung',
    zahnersatz: 'Zahnersatz',
    kieferorthopaedie: 'Kieferorthopädie',
    heilmittel: 'Heilmittel',
    hilfsmittel: 'Hilfsmittel',
    wahlleistung: 'Wahlleistungen (Krankenhaus)',
    sonstiges: 'Sonstiges',
  };

  const BENEFIT_LIMIT_SCOPE_LABELS: Record<BenefitLimitScope, string> = {
    behandlung: 'Je Behandlungsfall',
    jahr: 'Pro Kalenderjahr',
    lebenslang: 'Lebenslang',
  };

  const contractId = $derived(page.params.id as string);

  let contract = $state<Contract | null>(null);
  let insuredPersons = $state<InsuredPerson[]>([]);
  let persons = $state<Person[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [c, ip, ps] = await Promise.all([
        api.contracts.get(contractId),
        api.insured.list(contractId),
        api.persons.list(),
      ]);
      contract = c;
      insuredPersons = ip;
      persons = ps;
    } catch (e) {
      loadError = e instanceof ApiError || e instanceof Error ? e.message : 'Laden fehlgeschlagen.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // ---- Contract edit ----
  let editingContract = $state(false);
  let editInsurer = $state('');
  let editContractNumber = $state('');
  let editType = $state<ContractType>('vollversicherung');
  let editStartDate = $state('');
  let editEndDate = $state('');
  let editNotes = $state('');
  let savingContract = $state(false);
  let contractSaveError = $state<string | null>(null);

  function startEditContract() {
    if (!contract) return;
    editInsurer = contract.insurer_name;
    editContractNumber = contract.contract_number ?? '';
    editType = contract.type;
    editStartDate = contract.start_date;
    editEndDate = contract.end_date ?? '';
    editNotes = contract.notes ?? '';
    editingContract = true;
    contractSaveError = null;
  }

  async function saveContract() {
    if (!contract) return;
    savingContract = true;
    contractSaveError = null;
    try {
      contract = await api.contracts.update(contract.id, {
        insurer_name: editInsurer.trim(),
        contract_number: editContractNumber.trim() || null,
        type: editType,
        start_date: editStartDate,
        end_date: editEndDate.trim() || null,
        notes: editNotes.trim() || null,
      });
      editingContract = false;
    } catch (e) {
      contractSaveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      savingContract = false;
    }
  }

  // ---- Delete contract ----
  let deletingContract = $state(false);
  let confirmDelete = $state(false);

  async function deleteContract() {
    if (!contract) return;
    deletingContract = true;
    try {
      await api.contracts.remove(contract.id);
      await goto(resolve('/contracts'));
    } catch (e) {
      loadError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
      deletingContract = false;
      confirmDelete = false;
    }
  }

  // ---- Insured person form ----
  let showInsuredForm = $state(false);
  let editInsuredId = $state<string | null>(null);

  let ipPersonId = $state('');
  let ipKvnr = $state('');
  let ipTariffName = $state('');
  let ipMonthlyPremium = $state<number>(0);
  let ipSelfRetention = $state<number>(0);
  let ipStartDate = $state('');
  let ipEndDate = $state('');
  let ipNotes = $state('');

  // BRE structure
  let ipHasBre = $state(false);
  let ipStreakStart = $state('');
  type BreLevelForm = {
    claim_free_years: number;
    unit: 'pct' | 'eur';
    bre_years: number;
    pct_of_premium: number;
    fixed_amount_eur: number;
  };
  let ipBreLevels = $state<BreLevelForm[]>([
    {
      claim_free_years: 1,
      unit: 'pct',
      bre_years: 1,
      pct_of_premium: 100,
      fixed_amount_eur: 0,
    },
  ]);

  let savingInsured = $state(false);
  let insuredSaveError = $state<string | null>(null);

  // ---- Included benefits UI state ----
  type UiBenefitTier = { up_to: number; pct: number };
  type UiBenefitLimit = {
    scope: BenefitLimitScope;
    max_amount: number | undefined;
    age_min: number | undefined;
    age_max: number | undefined;
  };
  type UiAnnualStaffelEntry = { policy_year: number; cumulative_cap: number | undefined };
  type UiBenefit = {
    category: BenefitCategory;
    waiting_period_months: number | undefined;
    beihilfe_satz: number | undefined;
    hasTiers: boolean;
    tiers: UiBenefitTier[];
    hasLimits: boolean;
    limits: UiBenefitLimit[];
    hasStaffel: boolean;
    annual_staffel: UiAnnualStaffelEntry[];
  };
  let ipHasIncludedBenefits = $state(false);
  let ipBenefits = $state<UiBenefit[]>([]);

  function addBreLevel() {
    const nextYears = (ipBreLevels[ipBreLevels.length - 1]?.claim_free_years ?? 0) + 1;
    ipBreLevels = [
      ...ipBreLevels,
      {
        claim_free_years: nextYears,
        unit: 'pct',
        bre_years: 1,
        pct_of_premium: 100,
        fixed_amount_eur: 0,
      },
    ];
  }

  function removeBreLevel(i: number) {
    ipBreLevels = ipBreLevels.filter((_, idx) => idx !== i);
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

  function addBenefit() {
    ipBenefits.push(defaultBenefit());
  }

  function removeBenefit(i: number) {
    ipBenefits.splice(i, 1);
  }

  function addTier(benefitIdx: number) {
    const tiers = ipBenefits[benefitIdx]!.tiers;
    const prevUpTo = tiers.length >= 2 ? tiers[tiers.length - 2]!.up_to : 0;
    tiers.splice(tiers.length - 1, 0, { up_to: prevUpTo + 500, pct: 100 });
  }

  function removeTier(benefitIdx: number, tierIdx: number) {
    const tiers = ipBenefits[benefitIdx]!.tiers;
    if (tierIdx === tiers.length - 1) return;
    tiers.splice(tierIdx, 1);
  }

  function addLimit(benefitIdx: number) {
    ipBenefits[benefitIdx]!.limits.push({
      scope: 'jahr',
      max_amount: undefined,
      age_min: undefined,
      age_max: undefined,
    });
  }

  function removeLimit(benefitIdx: number, limitIdx: number) {
    ipBenefits[benefitIdx]!.limits.splice(limitIdx, 1);
  }

  function addStaffelEntry(benefitIdx: number) {
    const staffel = ipBenefits[benefitIdx]!.annual_staffel;
    const nextYear = staffel.length > 0 ? staffel[staffel.length - 1]!.policy_year + 1 : 1;
    staffel.push({ policy_year: nextYear, cumulative_cap: undefined });
  }

  function removeStaffelEntry(benefitIdx: number, entryIdx: number) {
    ipBenefits[benefitIdx]!.annual_staffel.splice(entryIdx, 1);
  }

  function buildIncludedBenefits(): IncludedBenefits | null {
    if (!ipHasIncludedBenefits || ipBenefits.length === 0) return null;
    return includedBenefitsSchema.parse({
      benefits: ipBenefits.map((b) => {
        const benefit: Record<string, unknown> = { category: b.category };
        if (b.waiting_period_months !== undefined)
          benefit['waiting_period_months'] = b.waiting_period_months;
        if (b.beihilfe_satz !== undefined) benefit['beihilfe_satz'] = b.beihilfe_satz;
        if (b.hasTiers && b.tiers.length > 0) {
          benefit['tiers'] = b.tiers.map((t, idx) => ({
            pct: t.pct,
            up_to: idx === b.tiers.length - 1 ? null : t.up_to,
          }));
        }
        if (b.hasLimits && b.limits.length > 0) {
          benefit['limits'] = b.limits.map((l) => {
            const limit: Record<string, unknown> = {
              scope: l.scope,
              max_amount: l.max_amount ?? null,
            };
            if (l.age_min !== undefined) limit['age_min'] = l.age_min;
            if (l.age_max !== undefined) limit['age_max'] = l.age_max;
            return limit;
          });
        }
        if (b.hasStaffel && b.annual_staffel.length > 0) {
          benefit['annual_staffel'] = b.annual_staffel.map((e) => ({
            policy_year: e.policy_year,
            cumulative_cap: e.cumulative_cap ?? null,
          }));
        }
        return benefit;
      }),
    });
  }

  function openNewInsuredForm() {
    editInsuredId = null;
    ipPersonId = '';
    ipKvnr = '';
    ipTariffName = '';
    ipMonthlyPremium = 0;
    ipSelfRetention = 0;
    ipStartDate = '';
    ipEndDate = '';
    ipNotes = '';
    ipHasBre = false;
    ipStreakStart = '';
    ipBreLevels = [
      {
        claim_free_years: 1,
        unit: 'pct',
        bre_years: 1,
        pct_of_premium: 100,
        fixed_amount_eur: 0,
      },
    ];
    ipHasIncludedBenefits = false;
    ipBenefits = [];
    insuredSaveError = null;
    showInsuredForm = true;
  }

  function openEditInsuredForm(ip: InsuredPerson) {
    editInsuredId = ip.id;
    ipPersonId = ip.person_id;
    ipKvnr = ip.kvnr ?? '';
    ipTariffName = ip.tariff_name ?? '';
    ipMonthlyPremium = ip.monthly_premium;
    ipSelfRetention = ip.self_retention;
    ipStartDate = ip.start_date ?? '';
    ipEndDate = ip.end_date ?? '';
    ipNotes = ip.notes ?? '';
    if (ip.bre_structure) {
      ipHasBre = true;
      ipStreakStart = ip.bre_structure.current_streak_start ?? '';
      ipBreLevels = ip.bre_structure.levels.map((l) => ({
        claim_free_years: l.claim_free_years,
        unit: l.fixed_amount_eur !== undefined ? ('eur' as const) : ('pct' as const),
        bre_years: l.bre_years ?? 1,
        pct_of_premium: l.pct_of_premium ?? 100,
        fixed_amount_eur: l.fixed_amount_eur ?? 0,
      }));
    } else {
      ipHasBre = false;
      ipStreakStart = '';
      ipBreLevels = [
        {
          claim_free_years: 1,
          unit: 'pct',
          bre_years: 1,
          pct_of_premium: 100,
          fixed_amount_eur: 0,
        },
      ];
    }
    if (ip.included_benefits) {
      ipHasIncludedBenefits = true;
      ipBenefits = ip.included_benefits.benefits.map((b): UiBenefit => ({
        category: b.category,
        waiting_period_months: b.waiting_period_months,
        beihilfe_satz: b.beihilfe_satz,
        hasTiers: !!b.tiers && b.tiers.length > 0,
        tiers: b.tiers
          ? b.tiers.map((t) => ({ up_to: t.up_to ?? 0, pct: t.pct }))
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
    } else {
      ipHasIncludedBenefits = false;
      ipBenefits = [];
    }
    insuredSaveError = null;
    showInsuredForm = true;
  }

  function cancelInsuredForm() {
    showInsuredForm = false;
    editInsuredId = null;
  }

  async function saveInsuredPerson() {
    if (!ipPersonId) {
      insuredSaveError = 'Bitte eine Person auswählen.';
      return;
    }
    if (!(ipMonthlyPremium > 0)) {
      insuredSaveError = 'Bitte einen Monatsbeitrag (> 0) eingeben.';
      return;
    }

    const breStructure: BREStructure | null = ipHasBre
      ? {
          type: 'staffel',
          levels: ipBreLevels.map((l): BRELevel =>
            l.unit === 'eur'
              ? { claim_free_years: l.claim_free_years, fixed_amount_eur: l.fixed_amount_eur }
              : {
                  claim_free_years: l.claim_free_years,
                  bre_years: l.bre_years,
                  pct_of_premium: l.pct_of_premium,
                },
          ),
          current_streak_start: ipStreakStart || null,
        }
      : null;

    let includedBenefits: IncludedBenefits | null;
    try {
      includedBenefits = buildIncludedBenefits();
    } catch {
      insuredSaveError = 'Leistungskonfiguration ist ungültig. Bitte die Felder prüfen.';
      return;
    }

    const body = {
      person_id: ipPersonId,
      kvnr: ipKvnr.trim() || null,
      tariff_name: ipTariffName.trim() || null,
      monthly_premium: ipMonthlyPremium,
      self_retention: ipSelfRetention,
      bre_structure: breStructure,
      included_benefits: includedBenefits,
      start_date: ipStartDate.trim() || null,
      end_date: ipEndDate.trim() || null,
      notes: ipNotes.trim() || null,
    };

    savingInsured = true;
    insuredSaveError = null;
    try {
      if (editInsuredId) {
        const updated = await api.insured.update(editInsuredId, body);
        insuredPersons = insuredPersons.map((ip) => (ip.id === editInsuredId ? updated : ip));
      } else {
        const created = await api.insured.create(contractId, body);
        insuredPersons = [...insuredPersons, created];
      }
      showInsuredForm = false;
      editInsuredId = null;
    } catch (e) {
      insuredSaveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      savingInsured = false;
    }
  }

  async function removeInsured(insuredId: string) {
    if (
      !confirm('Versicherte Person wirklich entfernen? Alle zugehörigen Rechnungen gehen verloren.')
    )
      return;
    try {
      await api.insured.remove(insuredId);
      insuredPersons = insuredPersons.filter((ip) => ip.id !== insuredId);
    } catch (e) {
      loadError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Löschen fehlgeschlagen.';
    }
  }

  function personName(personId: string): string {
    return persons.find((p) => p.id === personId)?.name ?? personId;
  }

  const inputClass =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0';
</script>

<svelte:head>
  <title>{contract ? `${contract.insurer_name} · Vertrag` : 'Vertragsdetail'} · selbstbehalt</title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <h1 class="text-2xl font-bold tracking-tight">
    {contract?.insurer_name ?? 'Vertragsdetail'}
  </h1>

  {#if loading}
    <LoadingState label="Vertragsdaten werden geladen …" />
  {:else if loadError}
    <ErrorState title="Fehler" message={loadError} onRetry={load} />
  {:else if contract}
    <!-- Contract header -->
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{TYPE_LABELS[contract.type]}</Badge>
        {#if contract.contract_number}
          <span class="text-sm text-muted-foreground">Nr. {contract.contract_number}</span>
        {/if}
      </div>
      <div class="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onclick={startEditContract}>Bearbeiten</Button>
        <Button
          variant="outline"
          size="sm"
          class="border-destructive text-destructive hover:bg-destructive/10"
          onclick={() => {
            confirmDelete = true;
          }}
        >
          Löschen
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap gap-4 text-sm text-muted-foreground">
      <span
        >Versicherungsnehmer: <strong class="text-foreground"
          >{personName(contract.policyholder_id)}</strong
        ></span
      >
      <span>seit {contract.start_date}{contract.end_date ? ` bis ${contract.end_date}` : ''}</span>
    </div>

    {#if contract.notes}
      <p class="text-sm text-muted-foreground">{contract.notes}</p>
    {/if}

    {#if confirmDelete}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3"
        role="alertdialog"
      >
        <p class="text-sm leading-relaxed">
          Vertrag <strong>{contract.insurer_name}</strong> wirklich löschen? Alle versicherten Personen
          und deren Rechnungen werden unwiderruflich entfernt.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button variant="destructive" onclick={deleteContract} disabled={deletingContract}>
            {deletingContract ? 'Wird gelöscht …' : 'Ja, löschen'}
          </Button>
          <Button
            variant="outline"
            onclick={() => {
              confirmDelete = false;
            }}>Abbrechen</Button
          >
        </div>
      </div>
    {/if}

    <!-- Insured persons -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <h2 class="text-lg font-semibold">Versicherte Personen</h2>
      <Button size="sm" onclick={openNewInsuredForm}>+ Person hinzufügen</Button>
    </div>

    {#if insuredPersons.length === 0}
      <p class="text-sm text-muted-foreground">
        Noch keine versicherten Personen. Bitte mindestens eine hinzufügen.
      </p>
    {:else}
      <div class="space-y-3">
        {#each insuredPersons as ip (ip.id)}
          <Card>
            <CardContent class="pt-4 space-y-3">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p class="font-semibold">{ip.tariff_name ?? 'Tarif nicht angegeben'}</p>
                  <p class="text-sm text-muted-foreground">
                    {personName(ip.person_id)}{#if ip.kvnr}
                      · KVNR: {ip.kvnr}{/if}
                  </p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-semibold text-sm">{formatEur(ip.monthly_premium)} / Monat</span>
                  {#if ip.self_retention > 0}
                    <span class="text-sm text-muted-foreground"
                      >SB: {formatEur(ip.self_retention)}</span
                    >
                  {/if}
                  <button
                    type="button"
                    class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer border-none"
                    title="Bearbeiten"
                    onclick={() => openEditInsuredForm(ip)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none"
                    title="Entfernen"
                    onclick={() => void removeInsured(ip.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <BRETracker insuredPerson={ip} />
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}

    <!-- Insured person form -->
    {#if showInsuredForm}
      <Card class="border-primary border-2">
        <CardHeader>
          <CardTitle class="text-base"
            >{editInsuredId
              ? 'Versicherte Person bearbeiten'
              : 'Neue versicherte Person'}</CardTitle
          >
        </CardHeader>
        <CardContent>
          <form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              void saveInsuredPerson();
            }}
          >
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div class="space-y-1">
                <Label>Person <span class="text-destructive">*</span></Label>
                <select bind:value={ipPersonId} required class={inputClass}>
                  <option value="" disabled>Bitte wählen …</option>
                  {#each persons as person (person.id)}
                    <option value={person.id}>{person.name}</option>
                  {/each}
                </select>
              </div>

              <div class="space-y-1">
                <Label>KVNR</Label>
                <Input type="text" bind:value={ipKvnr} placeholder="optional" />
              </div>

              <div class="space-y-1">
                <Label>Tarifname</Label>
                <Input type="text" bind:value={ipTariffName} placeholder="optional" />
              </div>

              <div class="space-y-1">
                <Label>Monatsbeitrag (€) <span class="text-destructive">*</span></Label>
                <Input type="number" bind:value={ipMonthlyPremium} min="0" step="0.01" required />
              </div>

              <div class="space-y-1">
                <Label>Jährlicher Selbstbehalt (€)</Label>
                <Input type="number" bind:value={ipSelfRetention} min="0" step="0.01" />
              </div>

              <div class="space-y-1">
                <Label>Tarifbeginn</Label>
                <Input type="date" bind:value={ipStartDate} />
              </div>

              <div class="space-y-1">
                <Label>Tarifende</Label>
                <Input type="date" bind:value={ipEndDate} />
              </div>
            </div>

            <div class="space-y-1">
              <Label>Notizen</Label>
              <textarea
                bind:value={ipNotes}
                rows="2"
                class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              ></textarea>
            </div>

            <!-- BRE Structure -->
            <div class="space-y-3 p-3 rounded-md border border-border bg-muted/30">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" bind:checked={ipHasBre} class="rounded" />
                <span>BRE-Staffel konfigurieren</span>
              </label>

              {#if ipHasBre}
                <div class="space-y-1">
                  <Label>Leistungsfreiheit begann am</Label>
                  <Input type="date" bind:value={ipStreakStart} class="max-w-xs" />
                </div>

                <div class="space-y-2">
                  <div
                    class="grid grid-cols-[5rem_7rem_1fr_2rem] gap-2 text-xs font-semibold text-muted-foreground"
                  >
                    <span>Leistungsfreie Jahre</span>
                    <span>Art</span>
                    <span>Rückerstattung</span>
                    <span></span>
                  </div>
                  {#each ipBreLevels as level, i (i)}
                    <div class="grid grid-cols-[5rem_7rem_1fr_2rem] gap-2 items-center">
                      <input
                        type="number"
                        bind:value={level.claim_free_years}
                        min="1"
                        step="1"
                        required
                        class={inputClass}
                      />
                      <select bind:value={level.unit} class={inputClass}>
                        <option value="pct">% × Monate</option>
                        <option value="eur">Fixer €-Betrag</option>
                      </select>
                      {#if level.unit === 'pct'}
                        <span class="flex items-center gap-1 min-w-0">
                          <input
                            type="number"
                            bind:value={level.bre_years}
                            min="0"
                            step="0.5"
                            title="Anzahl Monatsbeiträge"
                            required
                            class="{inputClass} w-16 flex-shrink-0"
                          />
                          <span class="text-xs text-muted-foreground whitespace-nowrap">×</span>
                          <input
                            type="number"
                            bind:value={level.pct_of_premium}
                            min="0"
                            max="100"
                            step="1"
                            title="Anteil am Monatsbeitrag (%)"
                            required
                            class="{inputClass} w-16 flex-shrink-0"
                          />
                          <span class="text-xs text-muted-foreground whitespace-nowrap">%</span>
                        </span>
                      {:else}
                        <span class="flex items-center gap-1 min-w-0">
                          <input
                            type="number"
                            bind:value={level.fixed_amount_eur}
                            min="0"
                            step="0.01"
                            title="Fixer Rückerstattungsbetrag (€)"
                            required
                            class="{inputClass} w-24 flex-shrink-0"
                          />
                          <span class="text-xs text-muted-foreground whitespace-nowrap">€</span>
                        </span>
                      {/if}
                      <button
                        type="button"
                        class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none disabled:opacity-40"
                        onclick={() => removeBreLevel(i)}
                        disabled={ipBreLevels.length <= 1}
                      >
                        ✕
                      </button>
                    </div>
                  {/each}
                  <button
                    type="button"
                    class="text-sm text-primary underline cursor-pointer bg-transparent border-none p-0 self-start"
                    onclick={addBreLevel}
                  >
                    + Stufe hinzufügen
                  </button>
                </div>
              {/if}
            </div>

            <!-- Included Benefits -->
            <div class="space-y-3 p-3 rounded-md border border-border bg-muted/30">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" bind:checked={ipHasIncludedBenefits} class="rounded" />
                <span>Enthaltene Leistungen konfigurieren</span>
              </label>

              {#if ipHasIncludedBenefits}
                {#if ipBenefits.length === 0}
                  <p class="text-sm text-muted-foreground">
                    Noch kein Leistungsbereich hinzugefügt.
                  </p>
                {/if}

                {#each ipBenefits as benefit, i (i)}
                  <div class="space-y-3 p-3 rounded-md border border-border bg-card">
                    <div class="grid grid-cols-[2fr_1fr_1fr_2rem] gap-2 items-end">
                      <div class="space-y-1">
                        <Label>Leistungsbereich</Label>
                        <select bind:value={benefit.category} class={inputClass}>
                          {#each benefitCategoryValues as cat (cat)}
                            <option value={cat}>{BENEFIT_CATEGORY_LABELS[cat]}</option>
                          {/each}
                        </select>
                      </div>
                      <div class="space-y-1">
                        <Label>Wartezeit (Monate)</Label>
                        <input
                          type="number"
                          bind:value={benefit.waiting_period_months}
                          min="0"
                          step="1"
                          placeholder="keine"
                          class={inputClass}
                        />
                      </div>
                      <div class="space-y-1">
                        <Label>Beihilfe-Satz (%)</Label>
                        <input
                          type="number"
                          bind:value={benefit.beihilfe_satz}
                          min="0"
                          max="100"
                          step="1"
                          placeholder="–"
                          class={inputClass}
                        />
                      </div>
                      <button
                        type="button"
                        class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none mb-0.5"
                        title="Leistungsbereich entfernen"
                        onclick={() => removeBenefit(i)}
                      >
                        ✕
                      </button>
                    </div>

                    <!-- Tiers -->
                    <div class="space-y-2 pl-3 border-l-2 border-border">
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" bind:checked={benefit.hasTiers} class="rounded" />
                        <span>Erstattungsstaffel</span>
                      </label>
                      {#if benefit.hasTiers}
                        <div class="space-y-1">
                          <div
                            class="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs font-semibold text-muted-foreground"
                          >
                            <span>Bis (€)</span>
                            <span>Erstattung (%)</span>
                            <span></span>
                          </div>
                          {#each benefit.tiers as tier, j (j)}
                            <div class="grid grid-cols-[1fr_1fr_2rem] gap-2 items-center">
                              {#if j < benefit.tiers.length - 1}
                                <input
                                  type="number"
                                  bind:value={tier.up_to}
                                  min="0.01"
                                  step="0.01"
                                  class={inputClass}
                                />
                              {:else}
                                <span class="text-sm text-muted-foreground italic">Unbegrenzt</span>
                              {/if}
                              <input
                                type="number"
                                bind:value={tier.pct}
                                min="0"
                                max="100"
                                step="1"
                                class={inputClass}
                              />
                              <button
                                type="button"
                                class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none disabled:opacity-40"
                                onclick={() => removeTier(i, j)}
                                disabled={j === benefit.tiers.length - 1}
                              >
                                ✕
                              </button>
                            </div>
                          {/each}
                          <button
                            type="button"
                            class="text-sm text-primary underline cursor-pointer bg-transparent border-none p-0 self-start"
                            onclick={() => addTier(i)}
                          >
                            + Stufe hinzufügen
                          </button>
                        </div>
                      {/if}
                    </div>

                    <!-- Limits -->
                    <div class="space-y-2 pl-3 border-l-2 border-border">
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" bind:checked={benefit.hasLimits} class="rounded" />
                        <span>Summengrenzen</span>
                      </label>
                      {#if benefit.hasLimits}
                        {#each benefit.limits as lim, j (j)}
                          <div class="grid grid-cols-[1.5fr_1fr_0.7fr_0.7fr_2rem] gap-2 items-end">
                            <div class="space-y-1">
                              <Label>Zeitraum</Label>
                              <select bind:value={lim.scope} class={inputClass}>
                                {#each benefitLimitScopeValues as s (s)}
                                  <option value={s}>{BENEFIT_LIMIT_SCOPE_LABELS[s]}</option>
                                {/each}
                              </select>
                            </div>
                            <div class="space-y-1">
                              <Label>Höchstbetrag (€)</Label>
                              <input
                                type="number"
                                bind:value={lim.max_amount}
                                min="0"
                                step="0.01"
                                placeholder="unbegrenzt"
                                class={inputClass}
                              />
                            </div>
                            <div class="space-y-1">
                              <Label>Alter von</Label>
                              <input
                                type="number"
                                bind:value={lim.age_min}
                                min="0"
                                step="1"
                                placeholder="–"
                                class={inputClass}
                              />
                            </div>
                            <div class="space-y-1">
                              <Label>Alter bis</Label>
                              <input
                                type="number"
                                bind:value={lim.age_max}
                                min="0"
                                step="1"
                                placeholder="–"
                                class={inputClass}
                              />
                            </div>
                            <button
                              type="button"
                              class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none mb-0.5"
                              onclick={() => removeLimit(i, j)}
                            >
                              ✕
                            </button>
                          </div>
                        {/each}
                        <button
                          type="button"
                          class="text-sm text-primary underline cursor-pointer bg-transparent border-none p-0 self-start"
                          onclick={() => addLimit(i)}
                        >
                          + Grenze hinzufügen
                        </button>
                      {/if}
                    </div>

                    <!-- Annual Staffel -->
                    <div class="space-y-2 pl-3 border-l-2 border-border">
                      <label class="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" bind:checked={benefit.hasStaffel} class="rounded" />
                        <span>Aufbaujahre (Zahnstaffel)</span>
                      </label>
                      {#if benefit.hasStaffel}
                        <div class="space-y-1">
                          <div
                            class="grid grid-cols-[1fr_1fr_2rem] gap-2 text-xs font-semibold text-muted-foreground"
                          >
                            <span>Versicherungsjahr</span>
                            <span>Kum. Höchstbetrag (€)</span>
                            <span></span>
                          </div>
                          {#each benefit.annual_staffel as entry, j (j)}
                            <div class="grid grid-cols-[1fr_1fr_2rem] gap-2 items-center">
                              <input
                                type="number"
                                bind:value={entry.policy_year}
                                min="1"
                                step="1"
                                class={inputClass}
                              />
                              <input
                                type="number"
                                bind:value={entry.cumulative_cap}
                                min="0"
                                step="0.01"
                                placeholder="unbegrenzt"
                                class={inputClass}
                              />
                              <button
                                type="button"
                                class="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer border-none"
                                onclick={() => removeStaffelEntry(i, j)}
                              >
                                ✕
                              </button>
                            </div>
                          {/each}
                          <button
                            type="button"
                            class="text-sm text-primary underline cursor-pointer bg-transparent border-none p-0 self-start"
                            onclick={() => addStaffelEntry(i)}
                          >
                            + Jahr hinzufügen
                          </button>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}

                <button
                  type="button"
                  class="text-sm text-primary underline cursor-pointer bg-transparent border-none p-0 self-start"
                  onclick={addBenefit}
                >
                  + Leistungsbereich hinzufügen
                </button>
              {/if}
            </div>

            {#if insuredSaveError}
              <Alert variant="destructive">
                <AlertDescription>{insuredSaveError}</AlertDescription>
              </Alert>
            {/if}

            <div class="flex flex-wrap gap-2">
              <Button type="submit" disabled={savingInsured}>
                {savingInsured ? 'Wird gespeichert …' : editInsuredId ? 'Speichern' : 'Hinzufügen'}
              </Button>
              <Button type="button" variant="outline" onclick={cancelInsuredForm}>Abbrechen</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    {/if}
  {/if}

  <!-- Contract edit modal (inline) -->
  {#if editingContract && contract}
    <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div class="bg-card rounded-xl p-6 w-full max-w-lg space-y-4 shadow-lg">
        <h2 class="text-lg font-semibold">Vertrag bearbeiten</h2>
        <form
          class="space-y-4"
          onsubmit={(e) => {
            e.preventDefault();
            void saveContract();
          }}
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1">
              <Label>Versicherungsgesellschaft <span class="text-destructive">*</span></Label>
              <Input type="text" bind:value={editInsurer} required />
            </div>
            <div class="space-y-1">
              <Label>Vertragsart</Label>
              <select
                bind:value={editType}
                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {#each contractTypeValues as t (t)}
                  <option value={t}>{TYPE_LABELS[t]}</option>
                {/each}
              </select>
            </div>
            <div class="space-y-1">
              <Label>Vertragsnummer</Label>
              <Input type="text" bind:value={editContractNumber} />
            </div>
            <div class="space-y-1">
              <Label>Beginn</Label>
              <Input type="date" bind:value={editStartDate} required />
            </div>
            <div class="space-y-1">
              <Label>Ende</Label>
              <Input type="date" bind:value={editEndDate} />
            </div>
          </div>
          <div class="space-y-1">
            <Label>Notizen</Label>
            <textarea
              bind:value={editNotes}
              rows="2"
              class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
            ></textarea>
          </div>

          {#if contractSaveError}
            <Alert variant="destructive">
              <AlertDescription>{contractSaveError}</AlertDescription>
            </Alert>
          {/if}

          <div class="flex flex-wrap gap-2">
            <Button type="submit" disabled={savingContract}>
              {savingContract ? 'Wird gespeichert …' : 'Speichern'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onclick={() => {
                editingContract = false;
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>
