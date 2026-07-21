<script lang="ts">
  import PowerIcon from "@lucide/svelte/icons/power";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { toast } from "@/shared/lib/toast.svelte";
  import { appCatalog } from "@/features/desktop/catalog";
  import { settingsStore } from "@/features/desktop/settings.svelte";
  import type { AppId } from "@/features/desktop/types";
  import { cn } from "$lib/utils.js";

  type Props = {
    onOpenApp: (id: AppId) => void;
  };

  let { onOpenApp }: Props = $props();
</script>

<section
  class={cn("start-menu", settingsStore.current.taskbarAlignment === "left" && "align-left")}
  onclick={(event) => event.stopPropagation()}
  role="dialog"
  aria-label="Start menu"
>
  <div class="start-header">
    <div class="start-logo">N</div>
    <div>
      <strong>ND OS Web</strong>
      <span>Simple web starter</span>
    </div>
  </div>

  <div class="start-search text-muted-foreground">⌕&nbsp;&nbsp;Search is ready for your app data</div>

  <div class="start-apps">
    {#each Object.entries(appCatalog) as [id, app]}
      <Button
        variant="ghost"
        class="h-auto w-full justify-start gap-3 px-3 py-2"
        onclick={() => onOpenApp(id as AppId)}
      >
        <span class="text-xl">{app.icon}</span>
        <div class="flex flex-col items-start gap-0.5 text-left">
          <strong>{app.title}</strong>
          <small class="text-muted-foreground font-normal">{app.description}</small>
        </div>
      </Button>
    {/each}
  </div>

  <Separator />

  <footer class="flex items-center justify-between px-3 py-2">
    <span class="text-muted-foreground text-xs">Web-only mode</span>
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => toast.show("No native shutdown action in web mode")}
      aria-label="Power"
    >
      <PowerIcon />
    </Button>
  </footer>
</section>
