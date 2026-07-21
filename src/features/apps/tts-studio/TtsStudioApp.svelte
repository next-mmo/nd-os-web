<script lang="ts">
  import { onMount } from "svelte";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import StudioShell from "./components/StudioShell.svelte";
  import CompatibilityGate from "./components/CompatibilityGate.svelte";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

  onMount(() => {
    void studioStore.boot();
  });
</script>

{#if !studioStore.ready}
  <div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
    <Spinner class="size-6" />
    <p class="text-sm">Starting AI TTS Studio…</p>
  </div>
{:else}
  <StudioShell />
  {#if studioStore.showCompatGate && studioStore.compatibility}
    <CompatibilityGate />
  {/if}
{/if}
