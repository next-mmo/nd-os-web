<script lang="ts">
  import FolderIcon from "@lucide/svelte/icons/folder";
  import InfoIcon from "@lucide/svelte/icons/info";
  import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import SunIcon from "@lucide/svelte/icons/sun";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { toast } from "@/shared/lib/toast.svelte";
  import { desktopIcons } from "@/features/desktop/desktop-icons.svelte";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import type { AppId } from "@/features/desktop/types";

  type Props = {
    x: number;
    y: number;
    onOpenApp: (id: AppId) => void;
    onClose: () => void;
  };

  let { x, y, onOpenApp, onClose }: Props = $props();

  function toggleTheme() {
    settingsStore.toggleTheme();
    onClose();
  }
</script>

<nav
  class="context-menu flex w-56 flex-col gap-0.5 p-1"
  style={`left:${x}px;top:${y}px`}
  onclick={(event) => event.stopPropagation()}
  aria-label="Desktop context menu"
>
  <Button
    variant="ghost"
    size="sm"
    class="justify-start"
    onclick={() => toast.show("Connect New folder to your storage layer")}
  >
    <FolderIcon data-icon="inline-start" />
    New folder
  </Button>
  <Button variant="ghost" size="sm" class="justify-start" onclick={() => toast.show("Desktop refreshed")}>
    <RefreshCwIcon data-icon="inline-start" />
    Refresh
  </Button>
  <Button
    variant="ghost"
    size="sm"
    class="justify-start"
    onclick={() => {
      desktopIcons.reset();
      onClose();
      toast.show("Desktop icons reset");
    }}
  >
    <LayoutGridIcon data-icon="inline-start" />
    Reset icon layout
  </Button>
  <Separator class="my-1" />
  <Button variant="ghost" size="sm" class="justify-start" onclick={() => onOpenApp("settings")}>
    <SettingsIcon data-icon="inline-start" />
    Display settings
  </Button>
  <Button variant="ghost" size="sm" class="justify-start" onclick={toggleTheme}>
    {#if settingsStore.current.theme === "dark"}
      <SunIcon data-icon="inline-start" />
      Light mode
    {:else}
      <MoonIcon data-icon="inline-start" />
      Dark mode
    {/if}
  </Button>
  <Separator class="my-1" />
  <Button variant="ghost" size="sm" class="justify-start" onclick={() => onOpenApp("about")}>
    <InfoIcon data-icon="inline-start" />
    About ND OS Web
  </Button>
</nav>
