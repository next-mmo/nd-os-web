<script lang="ts">
  import { formatBytes, formatDuration, type VideoJob } from "@nd-os/video-engine";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import XIcon from "@lucide/svelte/icons/x";
  import CheckIcon from "@lucide/svelte/icons/check";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { videoStore } from "@/features/video/stores/video.store.svelte";

  /** Percentage saved (or added) relative to the input, for finished jobs. */
  function sizeDelta(job: VideoJob): string | null {
    if (!job.inputBytes || !job.outputBytes) return null;
    const ratio = job.outputBytes / job.inputBytes;
    const pct = Math.round(Math.abs(1 - ratio) * 100);
    if (pct < 1) return "about the same size";
    return ratio < 1 ? `${pct}% smaller` : `${pct}% larger`;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="border-border flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
    <h3 class="text-sm font-medium">Results</h3>
    {#if videoStore.jobs.length}
      <Button
        variant="ghost"
        size="sm"
        class="h-7 text-[11px]"
        onclick={() => videoStore.clearJobs()}
      >
        Clear all
      </Button>
    {/if}
  </div>

  <ScrollArea class="min-h-0 flex-1">
    {#if videoStore.jobs.length === 0}
      <div class="text-muted-foreground flex flex-col items-center gap-1 px-6 py-16 text-center">
        <p class="text-sm">Nothing rendered yet</p>
        <p class="text-[11px]">Pick a tool, add a file, and results land here.</p>
      </div>
    {:else}
      <div class="flex flex-col gap-3 p-3">
        {#each videoStore.jobs as job (job.id)}
          <div class="border-border rounded-[12px] border">
            <div class="flex items-start gap-2 p-3">
              <div class="mt-0.5 shrink-0">
                {#if job.status === "running"}
                  <Spinner class="size-4" />
                {:else if job.status === "done"}
                  <CheckIcon class="size-4 text-emerald-500" />
                {:else if job.status === "error"}
                  <TriangleAlertIcon class="text-destructive size-4" />
                {:else}
                  <XIcon class="text-muted-foreground size-4" />
                {/if}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">{job.toolTitle}</span>
                  {#if job.status === "done"}
                    <Badge variant="secondary" class="shrink-0 font-normal">
                      {formatDuration(job.elapsedMs / 1000)}
                    </Badge>
                  {/if}
                </div>
                <div class="text-muted-foreground truncate text-[11px]">{job.sourceName}</div>
              </div>
              {#if job.status !== "running"}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove result"
                  onclick={() => videoStore.removeJob(job.id)}
                >
                  <TrashIcon />
                </Button>
              {/if}
            </div>

            {#if job.status === "running"}
              <div class="px-3 pb-3">
                <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    class="bg-primary h-full rounded-full transition-[width] duration-200"
                    style:width={`${Math.round(job.progress * 100)}%`}
                  ></div>
                </div>
                <div class="text-muted-foreground mt-1.5 flex justify-between text-[11px]">
                  <span class="truncate">{job.stepLabel}</span>
                  <span class="shrink-0 font-mono">{Math.round(job.progress * 100)}%</span>
                </div>
              </div>
            {:else if job.status === "error"}
              <div class="px-3 pb-3">
                <p class="text-destructive text-[11px] leading-snug break-words">{job.error}</p>
                {#if job.log.length}
                  <details class="mt-2">
                    <summary class="text-muted-foreground cursor-pointer text-[11px]">
                      ffmpeg output
                    </summary>
                    <pre
                      class="text-muted-foreground bg-muted/50 mt-1 max-h-48 overflow-auto rounded-[8px] p-2 text-[10px] leading-snug whitespace-pre-wrap">{job.log
                        .slice(-60)
                        .join("\n")}</pre>
                  </details>
                {/if}
              </div>
            {:else if job.status === "done"}
              <div class="px-3 pb-3">
                {#if job.artifacts.length === 1}
                  {@const artifact = job.artifacts[0]!}
                  <div class="bg-muted/40 overflow-hidden rounded-[10px]">
                    {#if artifact.mime.startsWith("video/")}
                      <!-- svelte-ignore a11y_media_has_caption -->
                      <video src={artifact.url} controls class="max-h-56 w-full bg-black"></video>
                    {:else if artifact.mime.startsWith("image/")}
                      <img src={artifact.url} alt={artifact.name} class="max-h-56 w-full object-contain" />
                    {:else if artifact.mime.startsWith("audio/")}
                      <audio src={artifact.url} controls class="w-full p-2"></audio>
                    {/if}
                  </div>
                {:else}
                  <div class="grid grid-cols-4 gap-1">
                    {#each job.artifacts.slice(0, 8) as artifact (artifact.name)}
                      <img
                        src={artifact.url}
                        alt={artifact.name}
                        class="bg-muted aspect-video w-full rounded-[6px] object-cover"
                      />
                    {/each}
                  </div>
                  <p class="text-muted-foreground mt-1.5 text-[11px]">
                    {job.artifacts.length} frames
                  </p>
                {/if}

                <div class="mt-2 flex items-center justify-between gap-2">
                  <span class="text-muted-foreground truncate text-[11px]">
                    {formatBytes(job.outputBytes)}
                    {#if sizeDelta(job)}· {sizeDelta(job)}{/if}
                  </span>
                  <Button size="sm" class="h-7 shrink-0 gap-1.5" onclick={() => void videoStore.downloadAll(job)}>
                    <DownloadIcon />
                    {job.artifacts.length > 1 ? "Download zip" : "Download"}
                  </Button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
