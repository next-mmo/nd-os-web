<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
  import { workspace } from "@/domains/workspace";
  import { toast } from "@/shared/lib/toast.svelte";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import { wallpapers } from "@/features/desktop/wallpapers";
  import type { Wallpaper } from "@/features/desktop/types";
  import {
    connectWorkspace,
    disconnectWorkspace,
    resetWorkspaceState,
  } from "@/features/desktop/workspace-actions";
  import { cn } from "$lib/utils.js";

  function resetSettings() {
    settingsStore.reset();
    toast.show("Settings reset");
  }

  const connecting = $derived(
    workspace.status === "connecting" || workspace.restoring,
  );
</script>

<div class="settings-layout grid h-full min-h-0 grid-cols-[220px_1fr]">
  <aside class="settings-sidebar border-border flex flex-col gap-3 border-r p-4">
    <div class="settings-avatar">N</div>
    <strong>ND OS Web</strong>
    <span class="text-muted-foreground text-xs">Browser settings</span>
    <nav class="flex flex-col gap-1 text-sm">
      <a class="hover:bg-muted rounded-md px-2 py-1.5" href="#appearance">Appearance</a>
      <a class="hover:bg-muted rounded-md px-2 py-1.5" href="#workspace">Workspace</a>
      <a class="hover:bg-muted rounded-md px-2 py-1.5" href="#taskbar">Taskbar</a>
      <a class="hover:bg-muted rounded-md px-2 py-1.5" href="#system">System</a>
    </nav>
  </aside>

  <div class="settings-content flex flex-col gap-6 overflow-auto p-6">
    <section id="appearance" class="settings-section flex flex-col gap-4">
      <div>
        <Badge variant="secondary">Personalization</Badge>
        <h1 class="mt-2 text-xl font-semibold">Appearance</h1>
      </div>

      <div class="setting-row flex items-center justify-between gap-4">
        <div>
          <Label>Theme</Label>
          <p class="text-muted-foreground text-xs">Choose the interface color mode.</p>
        </div>
        <ToggleGroup.Root
          type="single"
          value={settingsStore.current.theme}
          onValueChange={(v) => {
            if (v === "dark" || v === "light") settingsStore.patch({ theme: v });
          }}
          variant="outline"
        >
          <ToggleGroup.Item value="dark">Dark</ToggleGroup.Item>
          <ToggleGroup.Item value="light">Light</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>

      <div class="setting-block flex flex-col gap-2">
        <div>
          <Label>Wallpaper</Label>
          <p class="text-muted-foreground text-xs">Pure CSS backgrounds with no image service.</p>
        </div>
        <div class="wallpaper-grid grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each Object.keys(wallpapers) as wallpaper}
            <button
              type="button"
              class={cn(
                "wallpaper-option relative h-20 overflow-hidden rounded-lg border text-xs capitalize",
                settingsStore.current.wallpaper === wallpaper && "ring-ring ring-2",
              )}
              style={`background:${wallpapers[wallpaper as Wallpaper]}`}
              onclick={() => settingsStore.patch({ wallpaper: wallpaper as Wallpaper })}
              aria-label={`Use ${wallpaper} wallpaper`}
            >
              <span class="bg-background/80 absolute inset-x-0 bottom-0 px-1 py-0.5">{wallpaper}</span>
            </button>
          {/each}
        </div>
      </div>

      <div class="setting-row flex items-center justify-between gap-4">
        <div>
          <Label for="accent">Accent color</Label>
          <p class="text-muted-foreground text-xs">Used for highlights and active controls.</p>
        </div>
        <input
          id="accent"
          class="color-input size-9 cursor-pointer rounded border"
          type="color"
          value={settingsStore.current.accent}
          oninput={(event) => settingsStore.patch({ accent: event.currentTarget.value })}
          aria-label="Accent color"
        />
      </div>
    </section>

    <Separator />

    <section id="workspace" class="settings-section flex flex-col gap-4">
      <div>
        <Badge variant="secondary">Storage</Badge>
        <h2 class="mt-2 text-lg font-semibold">Workspace</h2>
      </div>

      <Card.Root>
        <Card.Header>
          <Card.Title>Connection</Card.Title>
          <Card.Description>
            {#if workspace.status === "connected"}
              Connected — files stay in this browser after reload until you disconnect.
            {:else if connecting}
              {workspace.restoring ? "Restoring your workspace..." : "Connecting..."}
            {:else}
              Not connected — connect once to create a durable workspace.
            {/if}
          </Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-wrap gap-2">
          {#if workspace.status === "connected"}
            <Button variant="outline" onclick={disconnectWorkspace}>Disconnect</Button>
          {:else}
            <Button onclick={connectWorkspace} disabled={connecting}>
              {#if connecting}
                <Spinner data-icon="inline-start" />
                {workspace.restoring ? "Loading..." : "Connecting..."}
              {:else}
                Connect workspace
              {/if}
            </Button>
          {/if}
          {#if workspace.status !== "connected"}
            <Button variant="destructive" onclick={resetWorkspaceState}>Reset stored state</Button>
          {/if}
        </Card.Content>
        {#if workspace.error}
          <Card.Footer>
            <p class="text-destructive text-sm">⚠ {workspace.error}</p>
          </Card.Footer>
        {/if}
      </Card.Root>

      <p class="text-muted-foreground text-sm">
        Workspace files are stored in persistent browser storage. They survive reloads and stay
        available until you disconnect or reset. They are private to this browser profile.
      </p>
    </section>

    <Separator />

    <section id="taskbar" class="settings-section flex flex-col gap-4">
      <div>
        <Badge variant="secondary">Navigation</Badge>
        <h2 class="mt-2 text-lg font-semibold">Taskbar</h2>
      </div>

      <div class="setting-row flex items-center justify-between gap-4">
        <div>
          <Label>Alignment</Label>
          <p class="text-muted-foreground text-xs">Position app buttons left or center.</p>
        </div>
        <ToggleGroup.Root
          type="single"
          value={settingsStore.current.taskbarAlignment}
          onValueChange={(v) =>
            v && settingsStore.patch({ taskbarAlignment: v as "left" | "center" })}
          variant="outline"
        >
          <ToggleGroup.Item value="left">Left</ToggleGroup.Item>
          <ToggleGroup.Item value="center">Center</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>

      <div class="setting-row flex items-center justify-between gap-4">
        <div>
          <Label for="show-seconds">Show clock seconds</Label>
          <p class="text-muted-foreground text-xs">Add seconds to the top bar clock.</p>
        </div>
        <Switch
          id="show-seconds"
          checked={settingsStore.current.showSeconds}
          onCheckedChange={(checked) => settingsStore.patch({ showSeconds: checked })}
        />
      </div>
    </section>

    <Separator />

    <section id="system" class="settings-section flex flex-col gap-4">
      <div>
        <Badge variant="secondary">Starter status</Badge>
        <h2 class="mt-2 text-lg font-semibold">System</h2>
      </div>

      <Card.Root>
        <Card.Content class="system-card grid grid-cols-2 gap-4 pt-6 text-sm">
          <div><span class="text-muted-foreground">Runtime</span><strong class="block">Browser only</strong></div>
          <div><span class="text-muted-foreground">Native bridge</span><strong class="block">Not included</strong></div>
          <div><span class="text-muted-foreground">UI kit</span><strong class="block">shadcn-svelte</strong></div>
          <div><span class="text-muted-foreground">Persistence</span><strong class="block">localStorage</strong></div>
        </Card.Content>
        <Card.Footer>
          <Button variant="destructive" onclick={resetSettings}>Reset settings</Button>
        </Card.Footer>
      </Card.Root>
    </section>
  </div>
</div>
