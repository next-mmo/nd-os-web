<script lang="ts">
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import { toggleMode, mode } from "mode-watcher";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import { providerRegistry } from "@/features/providers";

  const providers = providerRegistry.list();

  let editingName = $state(false);
  let nameDraft = $state("");

  function startRename() {
    nameDraft = studioStore.currentProject?.name ?? "";
    editingName = true;
  }

  async function commitRename() {
    editingName = false;
    if (nameDraft.trim()) await studioStore.renameProject(nameDraft.trim());
  }
</script>

<header class="border-border flex h-12 shrink-0 items-center gap-3 border-b px-3">
  <div class="min-w-0 flex-1">
    {#if editingName}
      <input
        class="border-input bg-background focus-visible:ring-ring w-full max-w-xs rounded-[10px] border px-2 py-1 text-sm outline-none focus-visible:ring-2"
        bind:value={nameDraft}
        onblur={commitRename}
        onkeydown={(e) => e.key === "Enter" && commitRename()}
      />
    {:else}
      <button class="truncate text-left text-sm font-medium" onclick={startRename}>
        {studioStore.currentProject?.name ?? "Untitled"}
      </button>
    {/if}
    <div class="text-muted-foreground text-[11px]">
      {studioStore.saveStatus === "saving" ? "Saving…" : "Saved locally"}
    </div>
  </div>

  <Badge variant="outline" class="max-w-[220px] truncate font-normal">
    {studioStore.runtimeStatus.label}
  </Badge>

  <Select.Root type="single" bind:value={studioStore.providerId}>
    <Select.Trigger class="w-[180px]" size="sm">
      {providers.find((p) => p.metadata.id === studioStore.providerId)?.metadata.name ??
        "Provider"}
    </Select.Trigger>
    <Select.Content>
      <Select.Group>
        {#each providers as p}
          <Select.Item value={p.metadata.id} label={p.metadata.name}>
            {p.metadata.name}
          </Select.Item>
        {/each}
      </Select.Group>
    </Select.Content>
  </Select.Root>

  {#if studioStore.compatibility}
    <Badge
      variant={studioStore.compatibility.tier === "recommended" ? "default" : "secondary"}
      class="hidden font-normal lg:inline-flex"
    >
      {studioStore.compatibility.tier}
    </Badge>
  {/if}

  <Button variant="ghost" size="icon-sm" onclick={toggleMode} aria-label="Toggle theme">
    {#if mode.current === "dark"}
      <SunIcon />
    {:else}
      <MoonIcon />
    {/if}
  </Button>

  <Button
    variant="ghost"
    size="icon-sm"
    onclick={() => (studioStore.view = "settings")}
    aria-label="Settings"
  >
    <SettingsIcon />
  </Button>
</header>
