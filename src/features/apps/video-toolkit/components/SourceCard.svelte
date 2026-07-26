<script lang="ts">
  import { formatBitrate, formatBytes, formatDuration } from "@nd-os/video-engine";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ClapperboardIcon from "@lucide/svelte/icons/clapperboard";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { cn } from "$lib/utils.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";

  let dragging = $state(false);
  let picker: HTMLInputElement;

  const multi = $derived(videoStore.tool.multiClip === true);
  const accept = $derived(videoStore.tool.accepts === "video" ? "video/*" : "video/*,audio/*");

  async function accept_files(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    if (multi) await videoStore.addClips(files);
    else await videoStore.setSource(files[0]!);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    void accept_files(event.dataTransfer?.files ?? null);
  }
</script>

<div class="border-border rounded-[12px] border p-3">
  <input
    bind:this={picker}
    type="file"
    class="hidden"
    {accept}
    multiple={multi}
    onchange={(e) => {
      void accept_files(e.currentTarget.files);
      e.currentTarget.value = "";
    }}
  />

  {#if multi}
    <div class="mb-2 flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium">Clips</h3>
      <Button size="sm" variant="outline" class="h-7" onclick={() => picker.click()}>
        <PlusIcon /> Add clips
      </Button>
    </div>

    {#if videoStore.clips.length === 0}
      <button
        type="button"
        class={cn(
          "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground flex w-full flex-col items-center gap-2 rounded-[10px] border border-dashed px-4 py-8 text-sm transition-colors",
          dragging && "border-primary text-foreground bg-primary/5",
        )}
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
        onclick={() => picker.click()}
      >
        <UploadIcon class="size-5" />
        Drop two or more clips here, in the order you want them joined
      </button>
    {:else}
      <ol class="flex flex-col gap-1">
        {#each videoStore.clips as clip, i (clip.path)}
          <li class="border-border flex items-center gap-2 rounded-[10px] border px-2 py-1.5">
            <span class="text-muted-foreground w-4 shrink-0 text-center font-mono text-[11px]">
              {i + 1}
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs">{clip.file.name}</div>
              <div class="text-muted-foreground text-[11px]">
                {#if clip.info}
                  {formatDuration(clip.info.durationSec, true)} · {clip.info.width}×{clip.info.height}
                  {#if !clip.info.hasAudio}· silent{/if}
                {:else}
                  {formatBytes(clip.file.size)}
                {/if}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={i === 0}
              aria-label="Move clip earlier"
              onclick={() => videoStore.moveClip(i, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={i === videoStore.clips.length - 1}
              aria-label="Move clip later"
              onclick={() => videoStore.moveClip(i, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove clip"
              onclick={() => videoStore.removeClip(i)}
            >
              <Trash2Icon />
            </Button>
          </li>
        {/each}
      </ol>
    {/if}
  {:else if !videoStore.source}
    <button
      type="button"
      class={cn(
        "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground flex w-full flex-col items-center gap-2 rounded-[10px] border border-dashed px-4 py-10 text-sm transition-colors",
        dragging && "border-primary text-foreground bg-primary/5",
      )}
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      onclick={() => picker.click()}
    >
      {#if videoStore.probing}
        <Spinner class="size-5" />
        Reading the file…
      {:else}
        <UploadIcon class="size-5" />
        Drop a file here or click to browse
        <span class="text-[11px]">Nothing is uploaded — it all stays on this device</span>
      {/if}
    </button>
  {:else}
    {@const info = videoStore.source.info}
    <div class="flex items-start gap-3">
      <div class="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-[10px]">
        <ClapperboardIcon class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium">{videoStore.source.file.name}</div>
        <div class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span>{formatBytes(videoStore.source.file.size)}</span>
          {#if info}
            {#if info.durationSec > 0}<span>· {formatDuration(info.durationSec, true)}</span>{/if}
            {#if info.hasVideo}
              <span>· {info.width}×{info.height}</span>
              {#if info.fps}<span>· {info.fps} fps</span>{/if}
            {/if}
            {#if info.bitrateKbps}<span>· {formatBitrate(info.bitrateKbps)}</span>{/if}
          {/if}
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1">
          {#if info?.videoCodec}<Badge variant="secondary" class="font-normal">{info.videoCodec}</Badge>{/if}
          {#if info?.audioCodec}
            <Badge variant="secondary" class="font-normal">{info.audioCodec}</Badge>
          {:else if info}
            <Badge variant="outline" class="font-normal">no audio</Badge>
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 gap-1">
        <Button variant="outline" size="sm" class="h-7" onclick={() => picker.click()}>Replace</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Remove file" onclick={() => videoStore.reset()}>
          <Trash2Icon />
        </Button>
      </div>
    </div>
  {/if}
</div>
