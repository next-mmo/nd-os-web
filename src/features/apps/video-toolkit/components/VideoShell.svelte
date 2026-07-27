<script lang="ts">
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";
  import JobsPanel from "./JobsPanel.svelte";
  import ToolPanel from "./ToolPanel.svelte";
  import ToolSidebar from "./ToolSidebar.svelte";
</script>

<div class="bg-background text-foreground flex h-full min-h-0 overflow-hidden rounded-[12px]">
  <ToolSidebar />

  <div class="flex min-w-0 flex-1 flex-col">
    {#if videoStore.engineState === "error"}
      <div class="p-4">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>The video engine could not start</AlertTitle>
          <AlertDescription>{videoStore.engineError}</AlertDescription>
        </Alert>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1">
      <div class="border-border min-w-0 flex-1 border-r lg:max-w-[420px]">
        <ToolPanel />
      </div>
      <div class="hidden min-w-0 flex-1 lg:block">
        <JobsPanel />
      </div>
    </div>

    <!-- Narrow windows stack the results below the controls instead. -->
    <div class="border-border h-[240px] shrink-0 border-t lg:hidden">
      <JobsPanel />
    </div>
  </div>
</div>
