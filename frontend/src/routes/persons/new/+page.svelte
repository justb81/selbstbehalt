<!-- SPDX-License-Identifier: Apache-2.0 -->
<!--
  Neue Person anlegen (docs/design.md §3.1, issue #35).
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { api, ApiError } from '$lib/api';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Card, CardContent } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';

  let name = $state('');
  let birthDate = $state('');
  let saving = $state(false);
  let formError = $state<string | null>(null);

  async function submit() {
    formError = null;
    if (!name.trim()) {
      formError = 'Bitte den Namen eingeben.';
      return;
    }
    saving = true;
    try {
      const person = await api.persons.create({
        name: name.trim(),
        birth_date: birthDate.trim() || null,
      });
      await goto(resolve('/persons/[id]', { id: person.id }));
    } catch (e) {
      formError =
        e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Person konnte nicht gespeichert werden.';
      saving = false;
    }
  }
</script>

<svelte:head><title>Neue Person · selbstbehalt</title></svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8 space-y-6">
  <div class="space-y-1">
    <a
      href={resolve('/persons')}
      class="text-sm text-muted-foreground hover:text-primary no-underline"
    >
      ← Personen
    </a>
    <h1 class="text-2xl font-bold tracking-tight">Neue Person</h1>
  </div>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      void submit();
    }}
  >
    <Card>
      <CardContent class="pt-6 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="space-y-1">
            <Label for="name">Name <span class="text-destructive">*</span></Label>
            <Input
              id="name"
              type="text"
              bind:value={name}
              required
              placeholder="Vollständiger Name"
            />
          </div>

          <div class="space-y-1">
            <Label for="birthDate">Geburtsdatum</Label>
            <Input id="birthDate" type="date" bind:value={birthDate} />
          </div>
        </div>

        {#if formError}
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        {/if}

        <div class="flex flex-wrap gap-2 items-center">
          <Button type="submit" disabled={saving}>
            {saving ? 'Wird gespeichert …' : 'Person anlegen'}
          </Button>
          <Button variant="outline" href={resolve('/persons')}>Abbrechen</Button>
        </div>
      </CardContent>
    </Card>
  </form>
</div>
