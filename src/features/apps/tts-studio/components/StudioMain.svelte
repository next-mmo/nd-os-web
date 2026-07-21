<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SquareIcon from "@lucide/svelte/icons/square";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import EraserIcon from "@lucide/svelte/icons/eraser";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import AudioPlayer from "./AudioPlayer.svelte";
  import GenerationQueue from "./GenerationQueue.svelte";

  const modes = [
    { id: "text-to-speech", label: "Text to Speech" },
    { id: "voice-design", label: "Voice Design" },
    { id: "voice-clone", label: "Voice Clone" },
    { id: "high-fidelity-clone", label: "High-Fidelity Clone" },
  ] as const;

  function onPaste(e: ClipboardEvent) {
    const raw = e.clipboardData?.getData("text");
    if (!raw) return;
    e.preventDefault();
    studioStore.pasteClean(raw);
  }
</script>

<div class="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
  <section class="border-border flex min-h-0 flex-col border-r">
    <div class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <Select.Root type="single" bind:value={studioStore.mode}>
        <Select.Trigger class="w-[200px]" size="sm">
          {modes.find((m) => m.id === studioStore.mode)?.label}
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each modes as m}
              <Select.Item value={m.id} label={m.label}>{m.label}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>

      <Select.Root
        type="single"
        value={studioStore.selectedVoiceId ?? undefined}
        onValueChange={(v) => {
          if (v) studioStore.selectedVoiceId = v;
        }}
      >
        <Select.Trigger class="w-[180px]" size="sm">
          {studioStore.selectedVoice?.name ?? "Voice"}
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {#each studioStore.voices as voice}
              <Select.Item value={voice.id} label={voice.name}>{voice.name}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>

      <div class="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
        <span>{studioStore.charCount} chars</span>
        <span>·</span>
        <span>{studioStore.wordCount} words</span>
        <span>·</span>
        <span>~{studioStore.estimatedDuration.toFixed(1)}s</span>
      </div>
    </div>

    <div class="min-h-0 flex-1 p-3">
      <Textarea
        class="h-full min-h-[240px] resize-none rounded-[12px] text-base leading-relaxed"
        placeholder="Enter or paste text (Khmer, English, Chinese, …)"
        bind:value={studioStore.text}
        oninput={() => {
          studioStore.resyncSegments();
          studioStore.scheduleAutosave();
        }}
        onpaste={onPaste}
      />
    </div>

    {#if studioStore.mode === "voice-design"}
      <div class="border-border space-y-2 border-t px-3 py-3">
        <Label>Voice description</Label>
        <Textarea
          class="min-h-[72px] rounded-[12px]"
          placeholder="A calm young Khmer woman with a warm, clear voice"
          bind:value={studioStore.voiceDescription}
        />
      </div>
    {/if}

    {#if studioStore.mode === "voice-clone" || studioStore.mode === "high-fidelity-clone"}
      <div class="border-border space-y-3 border-t px-3 py-3">
        <Alert>
          <AlertTitle>Voice cloning consent</AlertTitle>
          <AlertDescription>
            Only clone voices you own or have permission to use. Do not use this for fraud,
            impersonation, or misinformation.
          </AlertDescription>
        </Alert>
        <label class="flex items-start gap-2 text-sm">
          <Checkbox bind:checked={studioStore.consentChecked} class="mt-0.5" />
          <span>I confirm that I own this voice or have permission to use it.</span>
        </label>
        <div class="space-y-1">
          <Label>Speaking style (optional)</Label>
          <Input
            class="rounded-[12px]"
            placeholder="Warm, slightly slower pace"
            bind:value={studioStore.styleInstruction}
          />
        </div>
        {#if studioStore.mode === "high-fidelity-clone"}
          <div class="space-y-1">
            <Label>Exact reference transcript</Label>
            <Textarea
              class="min-h-[64px] rounded-[12px]"
              placeholder="Transcribe the reference audio exactly — improves similarity."
              bind:value={studioStore.referenceTranscript}
            />
          </div>
        {/if}
        <p class="text-muted-foreground text-xs">
          Reference audio upload/trim arrives with the full clone toolchain. Consent is required
          before generation.
        </p>
      </div>
    {/if}

    <div class="border-border flex flex-wrap items-center gap-2 border-t px-3 py-3">
      <Button
        size="lg"
        class="rounded-[12px] px-5"
        disabled={studioStore.generating || !studioStore.text.trim()}
        onclick={() => studioStore.generate()}
      >
        {#if studioStore.generating}
          <Spinner data-icon="inline-start" />
          Generating…
        {:else}
          <PlayIcon data-icon="inline-start" />
          Generate Speech
        {/if}
      </Button>
      <Button
        variant="outline"
        class="rounded-[12px]"
        disabled={!studioStore.generating}
        onclick={() => studioStore.cancel()}
      >
        <SquareIcon data-icon="inline-start" />
        Stop
      </Button>
      <Button
        variant="outline"
        class="rounded-[12px]"
        disabled={!studioStore.lastWav}
        onclick={() => studioStore.downloadLast()}
      >
        <DownloadIcon data-icon="inline-start" />
        Download WAV
      </Button>
      <Button
        variant="ghost"
        class="rounded-[12px]"
        onclick={() => studioStore.setText("")}
      >
        <EraserIcon data-icon="inline-start" />
        Clear
      </Button>
    </div>

    {#if studioStore.error}
      <div class="px-3 pb-3">
        <Alert variant="destructive">
          <AlertTitle>Couldn’t generate</AlertTitle>
          <AlertDescription class="flex flex-wrap items-center gap-2">
            <span>{studioStore.error}</span>
            {#if studioStore.errorAction === "Retry"}
              <Button size="sm" variant="outline" onclick={() => studioStore.generate()}>
                Retry
              </Button>
            {/if}
          </AlertDescription>
        </Alert>
      </div>
    {/if}

    <details class="border-border border-t px-3 py-2">
      <summary
        class="text-muted-foreground flex cursor-pointer list-none items-center gap-2 text-sm"
        onclick={() => (studioStore.showAdvanced = !studioStore.showAdvanced)}
      >
        <ChevronDownIcon class="size-4" />
        Advanced settings
      </summary>
      {#if studioStore.showAdvanced}
        <div class="grid grid-cols-2 gap-3 py-3 md:grid-cols-4">
          <div class="space-y-1">
            <Label>Guidance</Label>
            <Input
              type="number"
              step="0.1"
              class="rounded-[12px]"
              bind:value={studioStore.advanced.guidance}
              onchange={() => studioStore.scheduleAutosave()}
            />
          </div>
          <div class="space-y-1">
            <Label>Timesteps</Label>
            <Input
              type="number"
              class="rounded-[12px]"
              bind:value={studioStore.advanced.timesteps}
              onchange={() => studioStore.scheduleAutosave()}
            />
          </div>
          <div class="space-y-1">
            <Label>Temperature</Label>
            <Input
              type="number"
              step="0.1"
              class="rounded-[12px]"
              bind:value={studioStore.advanced.temperature}
              onchange={() => studioStore.scheduleAutosave()}
            />
          </div>
          <div class="space-y-1">
            <Label>Seed</Label>
            <Input
              type="number"
              class="rounded-[12px]"
              bind:value={studioStore.advanced.seed}
              onchange={() => studioStore.scheduleAutosave()}
            />
          </div>
        </div>
        <Button variant="ghost" size="sm" onclick={() => studioStore.resetAdvanced()}>
          Reset to recommended settings
        </Button>
      {/if}
    </details>
  </section>

  <section class="flex min-h-0 flex-col gap-3 overflow-hidden p-3">
    <AudioPlayer />
    <div class="min-h-0 flex-1">
      <GenerationQueue />
    </div>
    <div class="border-border rounded-[12px] border p-3">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-medium">Segments</span>
        <Badge variant="secondary">{studioStore.segments.length}</Badge>
      </div>
      <ScrollArea class="h-40">
        <div class="flex flex-col gap-1 pr-2">
          {#each studioStore.segments as seg}
            <div class="bg-muted/40 rounded-[10px] px-2 py-1.5 text-xs leading-snug">
              <span class="text-muted-foreground mr-1">{seg.order + 1}.</span>
              {seg.text}
            </div>
          {/each}
          {#if !studioStore.segments.length}
            <p class="text-muted-foreground text-xs">Segments appear as you write.</p>
          {/if}
        </div>
      </ScrollArea>
    </div>
  </section>
</div>
