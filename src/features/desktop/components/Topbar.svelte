<script lang="ts">
  import HardDriveIcon from "@lucide/svelte/icons/hard-drive";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Menubar from "$lib/components/ui/menubar/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { workspace } from "@/domains/workspace";
  import { formatDate, formatTime } from "@/shared/lib/format";
  import { buildMenubar } from "@/features/desktop/menubar";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import type { AppId } from "@/features/desktop/types";
  import { windowManager } from "@/features/desktop/window-manager.svelte";
  import {
    connectWorkspace,
    openWorkspaceSettings,
  } from "@/features/desktop/workspace-actions";

  type Props = {
    clock: Date;
    onToggleStart: () => void;
    onOpenSpotlight: () => void;
    onOpenApp: (id: AppId) => void;
    onResetSettings: () => void;
  };

  let { clock, onToggleStart, onOpenSpotlight, onOpenApp, onResetSettings }: Props = $props();

  const menubar = $derived(
    buildMenubar(windowManager.activeWindow, windowManager.windows, {
      openApp: onOpenApp,
      openSpotlight: onOpenSpotlight,
      resetSettings: onResetSettings,
    }),
  );

  const connecting = $derived(
    workspace.status === "connecting" || workspace.restoring,
  );
</script>

<header class="topbar" onclick={(event) => event.stopPropagation()}>
  <div class="topbar-left">
    <Button variant="ghost" size="sm" class="brand-button gap-2" onclick={onToggleStart}>
      <span class="brand-mark">N</span>
      <strong>ND OS Web</strong>
    </Button>

    <Menubar.Root class="menubar border-0 bg-transparent shadow-none">
      {#each menubar as menu (menu.id)}
        <Menubar.Menu>
          <Menubar.Trigger class="menubar-trigger px-2 text-xs font-medium data-[state=open]:bg-muted">
            {menu.label}
          </Menubar.Trigger>
          <Menubar.Content>
            {#each menu.items as item, i}
              {#if item.type === "separator"}
                <Menubar.Separator />
              {:else}
                <Menubar.Item
                  disabled={item.disabled}
                  onSelect={() => item.action?.()}
                >
                  {item.label}
                </Menubar.Item>
              {/if}
            {/each}
          </Menubar.Content>
        </Menubar.Menu>
      {/each}
    </Menubar.Root>
  </div>

  <div class="topbar-right flex items-center gap-2">
    <Badge variant="secondary" class="browser-mode hidden sm:inline-flex">Web mode</Badge>

    <Button
      variant="outline"
      size="sm"
      class="workspace-pill gap-1.5"
      disabled={connecting}
      onclick={() => {
        if (workspace.status === "connected") openWorkspaceSettings();
        else void connectWorkspace();
      }}
    >
      {#if connecting}
        <Spinner />
        <span>{workspace.restoring ? "Loading..." : "Connecting..."}</span>
      {:else}
        <HardDriveIcon data-icon="inline-start" />
        {#if workspace.status === "connected"}
          Connected
        {:else}
          Connect
        {/if}
      {/if}
    </Button>

    <Button variant="ghost" size="sm" class="topbar-clock" onclick={() => onOpenApp("settings")}>
      {formatDate(clock)}&nbsp;&nbsp;{formatTime(clock, settingsStore.current.showSeconds)}
    </Button>
  </div>
</header>
