<script lang="ts">
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import MicIcon from "@lucide/svelte/icons/mic";
  import LibraryIcon from "@lucide/svelte/icons/library";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import HardDriveIcon from "@lucide/svelte/icons/hard-drive";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import { Button } from "$lib/components/ui/button/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { cn } from "$lib/utils.js";
  import { studioStore, type StudioView } from "@/features/tts/stores/studio.store.svelte";

  const nav: { id: StudioView; label: string; icon: typeof MicIcon }[] = [
    { id: "studio", label: "Studio", icon: MicIcon },
    { id: "voices", label: "Voice Library", icon: LibraryIcon },
    { id: "batch", label: "Batch Generation", icon: LayersIcon },
    { id: "history", label: "History", icon: HistoryIcon },
    { id: "models", label: "Model Manager", icon: HardDriveIcon },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];
</script>

<aside
  class={cn(
    "border-border bg-card/40 flex shrink-0 flex-col border-r transition-[width] duration-200",
    studioStore.sidebarCollapsed ? "w-14" : "w-56",
  )}
>
  <div class="flex items-center justify-between gap-2 px-2 py-2">
    {#if !studioStore.sidebarCollapsed}
      <div class="px-1">
        <div class="text-sm font-semibold tracking-tight">AI TTS Studio</div>
        <div class="text-muted-foreground text-[11px]">Private · local-first</div>
      </div>
    {/if}
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => (studioStore.sidebarCollapsed = !studioStore.sidebarCollapsed)}
      aria-label="Toggle sidebar"
    >
      <PanelLeftIcon />
    </Button>
  </div>

  <div class="px-2 pb-2">
    <Button
      class="w-full justify-start gap-2"
      size="sm"
      onclick={() => studioStore.newProject()}
    >
      <FilePlusIcon />
      {#if !studioStore.sidebarCollapsed}New Project{/if}
    </Button>
  </div>

  <nav class="flex flex-col gap-0.5 px-2">
    {#each nav as item}
      {@const Icon = item.icon}
      <Button
        variant={studioStore.view === item.id ? "secondary" : "ghost"}
        size="sm"
        class={cn("justify-start gap-2", studioStore.sidebarCollapsed && "px-0 justify-center")}
        onclick={() => (studioStore.view = item.id)}
      >
        <Icon />
        {#if !studioStore.sidebarCollapsed}{item.label}{/if}
      </Button>
    {/each}
  </nav>

  {#if !studioStore.sidebarCollapsed}
    <Separator class="my-2" />
    <div class="text-muted-foreground px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
      Recent
    </div>
    <ScrollArea class="min-h-0 flex-1 px-2 pb-2">
      <div class="flex flex-col gap-0.5">
        {#each studioStore.projects.slice(0, 8) as project}
          <Button
            variant={studioStore.currentProjectId === project.id ? "secondary" : "ghost"}
            size="sm"
            class="h-auto justify-start truncate px-2 py-1.5 text-left text-xs font-normal"
            onclick={() => studioStore.openProject(project.id)}
          >
            {project.name}
          </Button>
        {/each}
      </div>
    </ScrollArea>
  {/if}
</aside>
