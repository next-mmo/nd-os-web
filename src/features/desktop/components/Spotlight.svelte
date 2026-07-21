<script lang="ts">
  import * as Command from "$lib/components/ui/command/index.js";
  import { searchApps } from "@/features/desktop/spotlight";
  import type { AppId } from "@/features/desktop/types";

  type Props = {
    open?: boolean;
    onLaunch: (id: AppId) => void;
    onClose: () => void;
  };

  let { open = $bindable(false), onLaunch, onClose }: Props = $props();

  let query = $state("");
  const results = $derived(searchApps(query));

  $effect(() => {
    if (!open) query = "";
  });
</script>

<Command.Dialog
  bind:open
  title="Spotlight"
  description="Search installed apps"
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Command.Input placeholder="Search apps…" bind:value={query} />
  <Command.List>
    <Command.Empty>No apps match “{query}”.</Command.Empty>
    <Command.Group heading="Applications">
      {#each results as app (app.id)}
        <Command.Item
          value={`${app.title} ${app.description}`}
          onSelect={() => {
            onLaunch(app.id);
            open = false;
          }}
        >
          <span class="text-base" aria-hidden="true">{app.icon}</span>
          <div class="flex flex-col gap-0.5">
            <span>{app.title}</span>
            <span class="text-muted-foreground text-xs">{app.description}</span>
          </div>
        </Command.Item>
      {/each}
    </Command.Group>
  </Command.List>
</Command.Dialog>
