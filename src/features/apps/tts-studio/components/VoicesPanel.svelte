<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";

  let name = $state("");
  let description = $state("");

  async function create() {
    if (!name.trim()) return;
    await studioStore.createVoice({
      name: name.trim(),
      mode: studioStore.mode,
      description: description.trim() || undefined,
    });
    name = "";
    description = "";
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-4 p-4">
  <div>
    <h2 class="text-lg font-semibold tracking-tight">Voice Library</h2>
    <p class="text-muted-foreground text-sm">
      Voices stay on this device. No celebrity presets. Synthetic and cloned voices are labeled.
    </p>
  </div>

  <div class="border-border grid gap-3 rounded-[12px] border p-3 md:grid-cols-3">
    <div class="space-y-1 md:col-span-1">
      <Label>Name</Label>
      <Input class="rounded-[12px]" bind:value={name} placeholder="My narrator" />
    </div>
    <div class="space-y-1 md:col-span-1">
      <Label>Description</Label>
      <Input
        class="rounded-[12px]"
        bind:value={description}
        placeholder="Calm documentary voice"
      />
    </div>
    <div class="flex items-end">
      <Button class="rounded-[12px]" onclick={create}>Create voice</Button>
    </div>
  </div>

  <ScrollArea class="min-h-0 flex-1">
    <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {#each studioStore.voices as voice}
        <article class="border-border rounded-[12px] border p-3">
          <div class="mb-2 flex items-start justify-between gap-2">
            <div>
              <strong class="text-sm">{voice.name}</strong>
              <p class="text-muted-foreground text-xs">{voice.description || "No description"}</p>
            </div>
            <Badge variant="outline" class="font-normal">{voice.mode}</Badge>
          </div>
          <div class="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              class="rounded-[10px]"
              onclick={() => {
                studioStore.selectedVoiceId = voice.id;
                studioStore.view = "studio";
              }}
            >
              Use
            </Button>
            <Button
              size="sm"
              variant="ghost"
              class="rounded-[10px]"
              onclick={() => studioStore.deleteVoice(voice.id)}
            >
              Delete
            </Button>
          </div>
        </article>
      {/each}
    </div>
  </ScrollArea>
</div>
