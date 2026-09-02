<!-- SPDX-FileCopyrightText: 2026 Bastian Rang and contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Edit dialog for a `contracts` row (§5.5). Extracted from
  `routes/contracts/[id]/+page.svelte` (issue #465), where it used to be a
  hand-built `fixed inset-0` overlay without `role`, `aria-modal`, focus trap,
  Escape handling or scroll lock — all of which the shadcn `Dialog` brings.

  Mounted only while editing, so the fields initialise from `contract` at
  construction; closing (Escape, the ✕ or "Abbrechen") flips the bound `open`.
-->
<script lang="ts">
  import { api, ApiError } from '$lib/api';
  import {
    CONTRACT_TYPE_LABELS,
    contractTypeValues,
    type Contract,
    type ContractType,
  } from '@selbstbehalt/shared';
  import { Alert, AlertDescription } from '@selbstbehalt/ui/alert';
  import { Button } from '@selbstbehalt/ui/button';
  import {
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogRoot,
    DialogTitle,
  } from '@selbstbehalt/ui/dialog';
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

  type Props = {
    contract: Contract;
    open?: boolean;
    onsaved: (contract: Contract) => void;
  };

  let { contract, open = $bindable(true), onsaved }: Props = $props();

  // The dialog is mounted per edit, so the fields start from the contract as it
  // was when it opened; a later refresh must not overwrite what the user typed.
  // svelte-ignore state_referenced_locally
  const initial = contract;

  let insurerName = $state(initial.insurer_name);
  let contractNumber = $state(initial.contract_number ?? '');
  let type = $state<ContractType>(initial.type);
  let startDate = $state(initial.start_date);
  let endDate = $state(initial.end_date ?? '');
  let notes = $state(initial.notes ?? '');

  let saving = $state(false);
  let saveError = $state<string | null>(null);

  const typeOptions = $derived(
    contractTypeValues.map((t) => ({ value: t, label: CONTRACT_TYPE_LABELS[t] })),
  );

  async function save() {
    saving = true;
    saveError = null;
    try {
      const updated = await api.contracts.update(contract.id, {
        insurer_name: insurerName.trim(),
        contract_number: contractNumber.trim() || null,
        type,
        start_date: startDate,
        end_date: endDate.trim() || null,
        notes: notes.trim() || null,
      });
      onsaved(updated);
      open = false;
    } catch (e) {
      saveError =
        e instanceof ApiError || e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
    } finally {
      saving = false;
    }
  }
</script>

<DialogRoot bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Vertrag bearbeiten</DialogTitle>
      <DialogDescription>
        Stammdaten des Vertrags bei {contract.insurer_name}.
      </DialogDescription>
    </DialogHeader>
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <Label for="contract-insurer">
            Versicherungsgesellschaft <span class="text-destructive">*</span>
          </Label>
          <Input id="contract-insurer" type="text" bind:value={insurerName} required />
        </div>
        <div class="space-y-1">
          <Label for="contract-type">Vertragsart</Label>
          <Select
            type="single"
            value={type}
            onValueChange={(v: string) => {
              if (v) type = v as ContractType;
            }}
            items={typeOptions}
          >
            <SelectTrigger id="contract-type" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {#each contractTypeValues as t (t)}
                <SelectItem value={t} label={CONTRACT_TYPE_LABELS[t]} />
              {/each}
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1">
          <Label for="contract-number">Vertragsnummer</Label>
          <Input id="contract-number" type="text" bind:value={contractNumber} />
        </div>
        <div class="space-y-1">
          <Label for="contract-start">Beginn</Label>
          <Input id="contract-start" type="date" bind:value={startDate} required />
        </div>
        <div class="space-y-1">
          <Label for="contract-end">Ende</Label>
          <Input id="contract-end" type="date" bind:value={endDate} />
        </div>
      </div>
      <div class="space-y-1">
        <Label for="contract-notes">Notizen</Label>
        <Textarea id="contract-notes" bind:value={notes} rows={2} />
      </div>

      {#if saveError}
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      {/if}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onclick={() => {
            open = false;
          }}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</DialogRoot>
