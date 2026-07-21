<script lang="ts">
  import PlayIcon from "@lucide/svelte/icons/play";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "$lib/components/ui/button/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";

  let audioEl: HTMLAudioElement | null = $state(null);
  let playing = $state(false);
  let current = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let rate = $state(1);

  function toggle() {
    if (!audioEl) return;
    if (audioEl.paused) {
      void audioEl.play();
      playing = true;
    } else {
      audioEl.pause();
      playing = false;
    }
  }

  function format(t: number) {
    if (!Number.isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }

  $effect(() => {
    if (audioEl) {
      audioEl.volume = volume;
      audioEl.playbackRate = rate;
    }
  });
</script>

<div class="border-border bg-card/50 rounded-[12px] border p-3 shadow-sm">
  <div class="mb-2 flex items-center justify-between">
    <strong class="text-sm">Audio preview</strong>
    <span class="text-muted-foreground text-xs">
      {format(current)} / {format(duration || studioStore.lastDuration)}
    </span>
  </div>

  <div class="bg-muted/50 mb-3 flex h-12 items-end gap-0.5 overflow-hidden rounded-[10px] px-2 py-1">
    {#each studioStore.previewPeaks as peak}
      <div
        class="bg-foreground/70 w-full rounded-sm"
        style={`height:${Math.max(8, peak * 100)}%`}
      ></div>
    {:else}
      <div class="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
        Generate speech to see waveform
      </div>
    {/each}
  </div>

  {#if studioStore.previewUrl}
    <audio
      bind:this={audioEl}
      src={studioStore.previewUrl}
      ontimeupdate={() => {
        if (audioEl) current = audioEl.currentTime;
      }}
      onloadedmetadata={() => {
        if (audioEl) duration = audioEl.duration;
      }}
      onended={() => (playing = false)}
    ></audio>
  {/if}

  <input
    class="accent-foreground mb-3 w-full"
    type="range"
    min="0"
    max={duration || 1}
    step="0.01"
    value={current}
    disabled={!studioStore.previewUrl}
    oninput={(e) => {
      const v = Number(e.currentTarget.value);
      current = v;
      if (audioEl) audioEl.currentTime = v;
    }}
  />

  <div class="flex flex-wrap items-center gap-2">
    <Button size="sm" class="rounded-[10px]" disabled={!studioStore.previewUrl} onclick={toggle}>
      {#if playing}
        <PauseIcon data-icon="inline-start" /> Pause
      {:else}
        <PlayIcon data-icon="inline-start" /> Play
      {/if}
    </Button>
    <Button
      size="sm"
      variant="outline"
      class="rounded-[10px]"
      disabled={!studioStore.lastWav}
      onclick={() => studioStore.downloadLast()}
    >
      <DownloadIcon data-icon="inline-start" /> Download
    </Button>
    <Button
      size="sm"
      variant="ghost"
      class="rounded-[10px]"
      disabled={studioStore.generating}
      onclick={() => studioStore.generate()}
    >
      <RefreshCwIcon data-icon="inline-start" /> Regenerate
    </Button>

    <label class="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
      Vol
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={volume}
        class="w-16"
      />
    </label>
    <label class="text-muted-foreground flex items-center gap-1 text-xs">
      Speed
      <select class="border-input rounded-md border bg-transparent px-1 py-0.5" bind:value={rate}>
        <option value={0.75}>0.75×</option>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
      </select>
    </label>
  </div>
</div>
