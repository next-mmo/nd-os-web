<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
</script>

<div class="flex h-full min-h-0 flex-col gap-3 p-4">
  <div>
    <h2 class="text-lg font-semibold">History</h2>
    <p class="text-muted-foreground text-sm">Local generation jobs for this browser profile.</p>
  </div>
  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-2">
      {#each studioStore.jobs as job}
        <article class="border-border rounded-[12px] border p-3 text-sm">
          <div class="mb-1 flex items-center gap-2">
            <Badge variant="outline" class="capitalize">{job.status.replace(/-/g, " ")}</Badge>
            <span class="text-muted-foreground text-xs">
              {new Date(job.createdAt).toLocaleString()}
            </span>
            {#if job.backend}
              <Badge variant="secondary">{job.backend}</Badge>
            {/if}
          </div>
          <p class="line-clamp-3 text-sm">{job.text}</p>
        </article>
      {:else}
        <p class="text-muted-foreground text-sm">No history yet.</p>
      {/each}
    </div>
  </ScrollArea>
</div>
