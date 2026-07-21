<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";

  function statusColor(status: string) {
    if (status === "completed") return "default";
    if (status === "failed") return "destructive";
    if (status === "cancelled") return "secondary";
    return "outline";
  }
</script>

<div class="border-border flex h-full min-h-0 flex-col rounded-[12px] border">
  <div class="border-border flex items-center justify-between border-b px-3 py-2">
    <strong class="text-sm">Generation queue</strong>
    <Badge variant="secondary">{studioStore.jobs.length}</Badge>
  </div>
  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-2 p-2">
      {#each studioStore.jobs.slice(0, 20) as job}
        <article class="bg-muted/30 rounded-[10px] p-2 text-xs">
          <div class="mb-1 flex items-center justify-between gap-2">
            <Badge variant={statusColor(job.status)} class="font-normal capitalize">
              {job.status.replace(/-/g, " ")}
            </Badge>
            <span class="text-muted-foreground">
              {job.durationSec ? `${job.durationSec.toFixed(1)}s` : "—"}
            </span>
          </div>
          <p class="line-clamp-2 leading-snug">{job.text}</p>
          <div class="text-muted-foreground mt-1 flex justify-between">
            <span>{job.message ?? ""}</span>
            <span>{Math.round((job.progress ?? 0) * 100)}%</span>
          </div>
          {#if job.error}
            <p class="text-destructive mt-1">{job.error}</p>
          {/if}
        </article>
      {:else}
        <p class="text-muted-foreground p-3 text-sm">No generations yet.</p>
      {/each}
    </div>
  </ScrollArea>
</div>
