<script lang="ts">
  import type { ExtraInputSpec } from "@nd-os/video-engine";
  import { formatBytes } from "@nd-os/video-engine";
  import PaperclipIcon from "@lucide/svelte/icons/paperclip";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";

  type Props = { spec: ExtraInputSpec };
  let { spec }: Props = $props();

  let picker: HTMLInputElement;
  const slot = $derived(videoStore.extras[spec.id]);
  const isFont = $derived(spec.role === "font");
</script>

<div class="flex flex-col gap-1.5">
  <div class="flex items-baseline justify-between gap-2">
    <Label class="text-xs font-medium">
      {spec.label}
      {#if spec.required}<span class="text-muted-foreground">· required</span>{/if}
    </Label>
    {#if isFont && videoStore.fonts.length > 0}
      <Button
        variant="ghost"
        size="sm"
        class="h-6 px-1.5 text-[11px]"
        onclick={() => picker.click()}
      >
        Add another
      </Button>
    {/if}
  </div>

  <input
    bind:this={picker}
    type="file"
    class="hidden"
    accept={spec.accept}
    onchange={(e) => {
      const file = e.currentTarget.files?.[0];
      if (file) void videoStore.setExtra(spec.id, file);
      e.currentTarget.value = "";
    }}
  />

  {#if isFont}
    {#if videoStore.fonts.length === 0}
      <Button variant="outline" size="sm" class="h-8 justify-start gap-2" onclick={() => picker.click()}>
        <PaperclipIcon /> Choose a .ttf or .otf file
      </Button>
    {:else}
      <div class="flex items-center gap-1.5">
        <Select.Root
          type="single"
          value={videoStore.selectedFontId ?? ""}
          onValueChange={(v) => v && (videoStore.selectedFontId = v)}
        >
          <Select.Trigger class="min-w-0 flex-1" size="sm">
            {videoStore.selectedFont?.id ?? "Choose a font"}
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {#each videoStore.fonts as font (font.id)}
                <Select.Item value={font.id} label={font.id}>{font.id}</Select.Item>
              {/each}
            </Select.Group>
          </Select.Content>
        </Select.Root>
        {#if videoStore.selectedFontId}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Forget this font"
            onclick={() => void videoStore.removeFont(videoStore.selectedFontId!)}
          >
            <Trash2Icon />
          </Button>
        {/if}
      </div>
    {/if}
  {:else if slot}
    <div class="border-border flex items-center gap-2 rounded-[10px] border px-2 py-1.5">
      <PaperclipIcon class="text-muted-foreground size-3.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs">{slot.file.name}</div>
        <div class="text-muted-foreground text-[11px]">{formatBytes(slot.file.size)}</div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Change file" onclick={() => picker.click()}>
        <PaperclipIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Remove file"
        onclick={() => videoStore.clearExtra(spec.id)}
      >
        <Trash2Icon />
      </Button>
    </div>
  {:else}
    <Button variant="outline" size="sm" class="h-8 justify-start gap-2" onclick={() => picker.click()}>
      <PaperclipIcon /> Choose a file
    </Button>
  {/if}

  {#if spec.hint}
    <p class="text-muted-foreground text-[11px] leading-snug">{spec.hint}</p>
  {/if}
</div>
