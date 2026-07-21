<script lang="ts">
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { appCatalog } from "@/features/desktop/catalog";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import type { AppId } from "@/features/desktop/types";
  import { windowManager } from "@/features/desktop/window-manager.svelte";
  import { cn } from "$lib/utils.js";

  type Props = {
    startOpen: boolean;
    onToggleStart: () => void;
    onOpenApp: (id: AppId) => void;
  };

  let { startOpen, onToggleStart, onOpenApp }: Props = $props();
</script>

<footer
  class={cn("taskbar-wrap", settingsStore.current.taskbarAlignment === "left" && "align-left")}
  onclick={(event) => event.stopPropagation()}
>
  <div class="taskbar">
    <Button
      variant={startOpen ? "secondary" : "ghost"}
      size="icon"
      class="start-button"
      onclick={onToggleStart}
      aria-label="Start menu"
    >
      <span>N</span>
    </Button>

    <Separator orientation="vertical" class="taskbar-divider h-6" />

    {#each Object.entries(appCatalog) as [id, app]}
      {@const taskWindow = windowManager.windows.find((w) => w.id === id)}
      <Button
        variant={windowManager.activeWindow === id && !taskWindow?.minimized
          ? "secondary"
          : "ghost"}
        size="icon"
        class={cn("taskbar-app", Boolean(taskWindow) && "running")}
        onclick={() => windowManager.toggleTaskbar(id as AppId)}
        aria-label={app.title}
        title={app.title}
      >
        <span>{app.icon}</span>
      </Button>
    {/each}

    <Separator orientation="vertical" class="taskbar-divider tray-divider h-6" />

    <Button
      variant="ghost"
      size="icon"
      class="tray"
      onclick={() => onOpenApp("settings")}
      title="Quick settings"
    >
      <SettingsIcon />
    </Button>
  </div>
</footer>
