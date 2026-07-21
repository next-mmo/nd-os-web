<script lang="ts">
  import { onMount } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { workspace } from "@/domains/workspace";
  import { toast } from "@/shared/lib/toast.svelte";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import { wallpapers } from "@/features/desktop/wallpapers";
  import type { AppId } from "@/features/desktop/types";
  import { windowManager } from "@/features/desktop/window-manager.svelte";
  import ContextMenu from "@/features/desktop/components/ContextMenu.svelte";
  import DesktopIcons from "@/features/desktop/components/DesktopIcons.svelte";
  import Spotlight from "@/features/desktop/components/Spotlight.svelte";
  import StartMenu from "@/features/desktop/components/StartMenu.svelte";
  import Taskbar from "@/features/desktop/components/Taskbar.svelte";
  import Topbar from "@/features/desktop/components/Topbar.svelte";
  import WindowFrame from "@/features/desktop/components/WindowFrame.svelte";

  let startOpen = $state(false);
  let selectedIcon = $state<AppId | null>(null);
  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let spotlightOpen = $state(false);
  let clock = $state(new Date());

  const shellStyle = $derived(
    `--wallpaper:${wallpapers[settingsStore.current.wallpaper]};--accent:${settingsStore.current.accent}`,
  );

  function openApp(id: AppId) {
    startOpen = false;
    contextMenu = null;
    selectedIcon = id;
    windowManager.open(id);
  }

  function openSpotlight() {
    spotlightOpen = true;
    startOpen = false;
    contextMenu = null;
  }

  function closeSpotlight() {
    spotlightOpen = false;
  }

  function launchFromSpotlight(id: AppId) {
    closeSpotlight();
    openApp(id);
  }

  function resetSettings() {
    settingsStore.reset();
    toast.show("Settings reset");
  }

  function dismissOverlays() {
    contextMenu = null;
    selectedIcon = null;
  }

  function handleDesktopContextMenu(event: MouseEvent) {
    event.preventDefault();
    selectedIcon = null;
    startOpen = false;
    contextMenu = {
      x: Math.min(event.clientX, window.innerWidth - 228),
      y: Math.min(event.clientY, window.innerHeight - 290),
    };
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      startOpen = false;
      contextMenu = null;
      if (spotlightOpen) closeSpotlight();
    }

    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      openApp("settings");
    }

    if ((event.metaKey || event.ctrlKey) && event.key === " ") {
      event.preventDefault();
      if (spotlightOpen) closeSpotlight();
      else openSpotlight();
    }
  }

  onMount(() => {
    settingsStore.hydrate();
    windowManager.hydrate();

    const restoreTimeout = window.setTimeout(() => {
      if (workspace.restoring || workspace.status === "connecting") {
        console.warn("[workspace] tryRestore timed out — falling back to disconnected");
        workspace.status = "disconnected";
        workspace.restoring = false;
      }
    }, 8000);

    workspace
      .tryRestore()
      .catch(() => {
        if (workspace.status === "connecting") {
          workspace.status = "disconnected";
        }
        workspace.restoring = false;
      })
      .finally(() => clearTimeout(restoreTimeout));

    const timer = window.setInterval(() => {
      clock = new Date();
    }, 1000);

    const handleMove = (event: MouseEvent) => windowManager.handlePointerMove(event);
    const handleUp = () => windowManager.endDrag();
    const handleResize = () => windowManager.resnapAll();

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("resize", handleResize);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("resize", handleResize);
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />
<ModeWatcher defaultMode="dark" />
<Toaster position="bottom-center" />

<div
  class="os-shell"
  style={shellStyle}
  oncontextmenu={handleDesktopContextMenu}
  onclick={dismissOverlays}
  role="application"
  aria-label="ND OS Web desktop"
>
  <div class="wallpaper" aria-hidden="true"></div>
  <div class="wallpaper-noise" aria-hidden="true"></div>

  <Topbar
    {clock}
    onToggleStart={() => (startOpen = !startOpen)}
    onOpenSpotlight={openSpotlight}
    onOpenApp={openApp}
    onResetSettings={resetSettings}
  />

  <main class="desktop-space">
    <DesktopIcons
      {selectedIcon}
      onSelect={(id) => (selectedIcon = id)}
      onOpen={openApp}
    />

    <section class="windows-layer" aria-label="Open windows">
      {#each windowManager.visibleWindows as windowState (windowState.id)}
        <WindowFrame
          {windowState}
          focused={windowManager.activeWindow === windowState.id}
        />
      {/each}
    </section>
  </main>

  {#if startOpen}
    <StartMenu onOpenApp={openApp} />
  {/if}

  {#if contextMenu}
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      onOpenApp={openApp}
      onClose={() => (contextMenu = null)}
    />
  {/if}

  <Spotlight bind:open={spotlightOpen} onLaunch={launchFromSpotlight} onClose={closeSpotlight} />

  <Taskbar
    {startOpen}
    onToggleStart={() => (startOpen = !startOpen)}
    onOpenApp={openApp}
  />
</div>
