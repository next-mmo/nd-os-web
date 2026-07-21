<script lang="ts">
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { workspace } from "@/domains/workspace";
  import { connectWorkspace } from "@/features/desktop/workspace-actions";
  import { cn } from "$lib/utils.js";
  import { notesStore } from "./notes-store.svelte";

  let prevStatus: string | null = null;
  let booted = false;

  $effect(() => {
    const status = workspace.status;
    void workspace.revision;

    // First paint: load local or workspace list.
    if (!booted) {
      booted = true;
      void notesStore.refresh();
      prevStatus = status;
      return;
    }

    // Re-sync when workspace connects/disconnects (not on every file revision).
    if (prevStatus !== status && (status === "connected" || status === "disconnected")) {
      void notesStore.refresh();
    }
    prevStatus = status;
  });

  const statusLabel = $derived(
    workspace.status === "connected"
      ? notesStore.saving
        ? "Saving…"
        : "Saved to workspace"
      : workspace.status === "connecting" || workspace.restoring
        ? "Connecting..."
        : notesStore.saving
          ? "Saving…"
          : "Saved locally",
  );

  function formatUpdated(ts: number): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  }
</script>

<div class="notes-app flex h-full min-h-0 gap-0">
  <aside class="border-border flex w-56 shrink-0 flex-col border-r">
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <strong class="text-sm">Notes</strong>
      <Button
        variant="outline"
        size="icon-sm"
        title="New note"
        onclick={() => notesStore.create()}
        disabled={workspace.status === "connecting" || workspace.restoring}
      >
        <FilePlusIcon />
      </Button>
    </div>

    {#if notesStore.loading}
      <div class="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Spinner />
        Loading…
      </div>
    {:else if !notesStore.notes.length}
      <div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-xs">
        <p>No notes yet.</p>
        <Button size="sm" variant="secondary" onclick={() => notesStore.create()}>New note</Button>
      </div>
    {:else}
      <ScrollArea class="min-h-0 flex-1">
        <div class="flex flex-col gap-0.5 p-1.5">
          {#each notesStore.notes as note (note.id)}
            <button
              type="button"
              class={cn(
                "hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors",
                notesStore.activeId === note.id && "bg-muted",
              )}
              onclick={() => notesStore.open(note.id)}
            >
              <span class="w-full truncate text-sm font-medium">{note.title}</span>
              <span class="text-muted-foreground text-[11px]">{formatUpdated(note.updatedAt)}</span>
            </button>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </aside>

  <div class="flex min-w-0 flex-1 flex-col gap-3 p-4">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-1">
        <Badge variant="secondary" class="w-fit">{statusLabel}</Badge>
        <h1 class="truncate text-lg font-semibold">
          {notesStore.activeNote?.title ?? "Notes"}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant="outline">Auto-save</Badge>
        {#if notesStore.activeId}
          <Button
            variant="destructive"
            size="icon-sm"
            title="Delete note"
            onclick={() => notesStore.remove(notesStore.activeId!)}
          >
            <Trash2Icon />
          </Button>
        {/if}
      </div>
    </div>

    {#if workspace.status === "connecting" || workspace.restoring}
      <Empty.Root class="flex-1 border">
        <Empty.Header>
          <Empty.Media variant="icon"><Spinner /></Empty.Media>
          <Empty.Title>Loading workspace…</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else if !notesStore.activeId}
      <Empty.Root class="flex-1 border">
        <Empty.Header>
          <Empty.Title>Select or create a note</Empty.Title>
          <Empty.Description>
            {workspace.status === "connected"
              ? "Notes are saved under /Notes in your workspace."
              : "Notes save in this browser. Connect a workspace to sync them."}
          </Empty.Description>
        </Empty.Header>
        <Empty.Content class="flex flex-wrap gap-2">
          <Button onclick={() => notesStore.create()}>New note</Button>
          {#if workspace.status !== "connected"}
            <Button variant="outline" onclick={connectWorkspace}>Connect workspace</Button>
          {/if}
        </Empty.Content>
      </Empty.Root>
    {:else}
      <Textarea
        class="min-h-0 flex-1 resize-none font-mono text-sm"
        bind:value={notesStore.content}
        oninput={() => notesStore.queueSave()}
        aria-label="Note editor"
      />
    {/if}
  </div>
</div>
