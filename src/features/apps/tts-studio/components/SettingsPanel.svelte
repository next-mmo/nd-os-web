<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import { tierLabel } from "@/features/tts/compatibility/check";

  type Props = { showCompatOnly?: boolean };
  let { showCompatOnly = false }: Props = $props();
</script>

<div class="flex h-full flex-col gap-4 overflow-auto p-4">
  {#if !showCompatOnly}
    <div>
      <h2 class="text-lg font-semibold">Settings</h2>
      <p class="text-muted-foreground text-sm">All data stays in this browser. Nothing is uploaded.</p>
    </div>

    <Alert>
      <AlertTitle>Safety</AlertTitle>
      <AlertDescription>
        Cloned and synthetic voices are for permitted use only. Do not use AI speech for fraud,
        impersonation, or misinformation.
      </AlertDescription>
    </Alert>

    <div class="border-border rounded-[12px] border p-4">
      <h3 class="mb-2 text-sm font-medium">Local data</h3>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          class="rounded-[12px]"
          onclick={() => {
            if (confirm("Delete all TTS Studio projects, voices, and history on this device?")) {
              void studioStore.clearAllLocalData();
            }
          }}
        >
          Clear all local data
        </Button>
        <Button
          variant="outline"
          class="rounded-[12px]"
          onclick={() => (studioStore.view = "compatibility")}
        >
          Open compatibility details
        </Button>
      </div>
    </div>
  {/if}

  {#if studioStore.compatibility}
    <div class="border-border rounded-[12px] border p-4">
      <div class="mb-2 flex items-center gap-2">
        <h3 class="text-sm font-medium">Device compatibility</h3>
        <Badge>{studioStore.compatibility.tier}</Badge>
      </div>
      <p class="text-sm">{tierLabel(studioStore.compatibility.tier)}</p>
      <details class="mt-3">
        <summary class="text-muted-foreground cursor-pointer text-sm">Detailed diagnostics</summary>
        <ul class="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-xs">
          {#each studioStore.compatibility.details as line}
            <li>{line}</li>
          {/each}
        </ul>
      </details>
    </div>
  {/if}
</div>
