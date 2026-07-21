<script lang="ts">
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import StudioSidebar from "./StudioSidebar.svelte";
  import StudioTopbar from "./StudioTopbar.svelte";
  import StudioMain from "./StudioMain.svelte";
  import VoicesPanel from "./VoicesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import ModelsPanel from "./ModelsPanel.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import BatchPanel from "./BatchPanel.svelte";
</script>

<div class="tts-studio bg-background text-foreground flex h-full min-h-0 overflow-hidden rounded-[12px]">
  <StudioSidebar />
  <div class="flex min-w-0 flex-1 flex-col">
    <StudioTopbar />
    <div class="min-h-0 flex-1 overflow-hidden">
      {#if studioStore.view === "studio"}
        <StudioMain />
      {:else if studioStore.view === "voices"}
        <VoicesPanel />
      {:else if studioStore.view === "history"}
        <HistoryPanel />
      {:else if studioStore.view === "models"}
        <ModelsPanel />
      {:else if studioStore.view === "settings"}
        <SettingsPanel />
      {:else if studioStore.view === "batch"}
        <BatchPanel />
      {:else if studioStore.view === "compatibility"}
        <SettingsPanel showCompatOnly />
      {/if}
    </div>
  </div>
</div>
