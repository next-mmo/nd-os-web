<script lang="ts">
  import { CATEGORY_LABELS, CATEGORY_ORDER, toolsInCategory } from "@nd-os/video-engine";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import { Button } from "$lib/components/ui/button/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { cn } from "$lib/utils.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";
  import { toolIcon } from "./tool-icons";

  let collapsed = $state(false);
</script>

<aside
  class={cn(
    "border-border bg-card/40 flex shrink-0 flex-col border-r transition-[width] duration-200",
    collapsed ? "w-14" : "w-60",
  )}
>
  <div class="flex items-center justify-between gap-2 px-2 py-2">
    {#if !collapsed}
      <div class="px-1">
        <div class="text-sm font-semibold tracking-tight">Video Toolkit</div>
        <div class="text-muted-foreground text-[11px]">Private · runs in this tab</div>
      </div>
    {/if}
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => (collapsed = !collapsed)}
      aria-label="Toggle sidebar"
    >
      <PanelLeftIcon />
    </Button>
  </div>

  <ScrollArea class="min-h-0 flex-1 px-2 pb-3">
    {#each CATEGORY_ORDER as category (category)}
      {#if !collapsed}
        <div
          class="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase"
        >
          {CATEGORY_LABELS[category]}
        </div>
      {:else}
        <div class="bg-border mx-2 my-2 h-px"></div>
      {/if}
      <div class="flex flex-col gap-0.5">
        {#each toolsInCategory(category) as tool (tool.id)}
          {@const Icon = toolIcon(tool.icon)}
          <Button
            variant={videoStore.toolId === tool.id ? "secondary" : "ghost"}
            size="sm"
            title={collapsed ? tool.title : tool.tagline}
            class={cn("h-auto justify-start gap-2 py-1.5", collapsed && "justify-center px-0")}
            onclick={() => videoStore.setTool(tool.id)}
          >
            <Icon class="shrink-0" />
            {#if !collapsed}<span class="truncate text-xs">{tool.title}</span>{/if}
          </Button>
        {/each}
      </div>
    {/each}
  </ScrollArea>
</aside>
