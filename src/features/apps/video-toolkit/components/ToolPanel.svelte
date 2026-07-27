<script lang="ts">
  import { visibleOptions } from "@nd-os/video-engine";
  import PlayIcon from "@lucide/svelte/icons/play";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";
  import ExtraInput from "./ExtraInput.svelte";
  import OptionField from "./OptionField.svelte";
  import SourceCard from "./SourceCard.svelte";
  import { toolIcon } from "./tool-icons";

  const tool = $derived(videoStore.tool);
  const Icon = $derived(toolIcon(tool.icon));
  const options = $derived(visibleOptions(tool.id, videoStore.values, videoStore.info));
  const duration = $derived(videoStore.info?.durationSec ?? 0);
  const blocked = $derived(videoStore.blockedReason);
</script>

<div class="flex h-full min-h-0 flex-col">
  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-4 p-4">
      <div class="flex items-start gap-3">
        <div class="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-[10px]">
          <Icon class="size-4.5" />
        </div>
        <div class="min-w-0">
          <h2 class="text-base leading-tight font-semibold">{tool.title}</h2>
          <p class="text-muted-foreground text-xs">{tool.tagline}</p>
        </div>
      </div>

      <SourceCard />

      {#if videoStore.notice}
        <div
          class="border-border bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-[10px] border p-2.5 text-[11px] leading-snug"
        >
          <TriangleAlertIcon class="mt-px size-3.5 shrink-0" />
          <span>{videoStore.notice}</span>
        </div>
      {/if}

      {#if tool.extras?.length}
        <div class="flex flex-col gap-3">
          {#each tool.extras as extra (extra.id)}
            <ExtraInput spec={extra} />
          {/each}
        </div>
        <Separator />
      {/if}

      <div class="flex flex-col gap-3">
        {#each options as option (option.id)}
          <OptionField
            spec={option}
            value={videoStore.values[option.id] ?? option.default}
            {duration}
            onchange={(value) => videoStore.setValue(option.id, value)}
          />
        {/each}
      </div>

      {#if tool.warning}
        <p class="text-muted-foreground border-border border-l-2 pl-2 text-[11px] leading-snug">
          {tool.warning}
        </p>
      {/if}
    </div>
  </ScrollArea>

  <div class="border-border bg-card/40 shrink-0 border-t p-3">
    {#each videoStore.planWarnings as warning (warning)}
      <p class="text-muted-foreground mb-2 flex items-start gap-1.5 text-[11px] leading-snug">
        <TriangleAlertIcon class="mt-px size-3 shrink-0" />
        <span>{warning}</span>
      </p>
    {/each}

    <div class="flex items-center gap-2">
      {#if videoStore.running}
        <Button variant="destructive" class="flex-1 gap-2" onclick={() => videoStore.cancel()}>
          <CircleXIcon /> Stop
        </Button>
      {:else}
        <Button class="flex-1 gap-2" disabled={blocked !== null} onclick={() => void videoStore.run()}>
          {#if videoStore.engineState === "loading" || videoStore.probing}
            <Spinner class="size-4" />
          {:else}
            <PlayIcon />
          {/if}
          Run {tool.title.toLowerCase()}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Reset options"
        disabled={videoStore.running}
        onclick={() => videoStore.resetValues()}
      >
        <RotateCcwIcon />
      </Button>
    </div>

    {#if blocked && !videoStore.running}
      <p class="text-muted-foreground mt-2 text-center text-[11px]">{blocked}</p>
    {/if}
  </div>
</div>
