<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import { tierLabel } from "@/features/tts/compatibility/check";
</script>

{#if studioStore.compatibility}
  <div
    class="bg-background/80 absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm"
    role="dialog"
    aria-label="Compatibility check"
  >
    <div class="border-border bg-card w-full max-w-lg rounded-[14px] border p-5 shadow-lg">
      <div class="mb-3 flex items-center gap-2">
        <h2 class="text-lg font-semibold">Device check</h2>
        <Badge>{studioStore.compatibility.tier}</Badge>
      </div>
      <p class="text-muted-foreground mb-4 text-sm">
        {tierLabel(studioStore.compatibility.tier)}
      </p>
      <details class="mb-4">
        <summary class="text-muted-foreground cursor-pointer text-sm">Detailed diagnostics</summary>
        <ul class="text-muted-foreground mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-xs">
          {#each studioStore.compatibility.details as line}
            <li>{line}</li>
          {/each}
        </ul>
      </details>
      <div class="flex justify-end gap-2">
        <Button
          variant="outline"
          class="rounded-[12px]"
          onclick={() => {
            studioStore.view = "compatibility";
            studioStore.dismissCompatGate();
          }}
        >
          Open details
        </Button>
        <Button class="rounded-[12px]" onclick={() => studioStore.dismissCompatGate()}>
          Continue
        </Button>
      </div>
    </div>
  </div>
{/if}
