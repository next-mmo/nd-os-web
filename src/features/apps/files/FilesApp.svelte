<script lang="ts">
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { workspace } from "@/domains/workspace";
  import { formatSize, iconForFile } from "@/shared/lib/format";
  import { breadcrumbs, joinPath } from "@/shared/lib/paths";
  import { toast } from "@/shared/lib/toast.svelte";
  import { connectWorkspace } from "@/features/desktop/workspace-actions";
  import { editorSession } from "@/features/apps/editor/editor-session.svelte";
  import { cn } from "$lib/utils.js";

  let filesCwd = $state("/");
  let filesEntries = $state<{ name: string; kind: "file" | "directory"; size?: number }[]>([]);
  let filesSelected = $state<string | null>(null);
  let filesLoading = $state(false);
  let filesError = $state<string | null>(null);

  async function refreshFiles() {
    if (workspace.status !== "connected") {
      filesEntries = [];
      filesError = null;
      return;
    }
    filesLoading = true;
    filesError = null;
    try {
      filesEntries = await workspace.list(filesCwd);
    } catch (err) {
      filesError = err instanceof Error ? err.message : String(err);
      filesEntries = [];
    } finally {
      filesLoading = false;
    }
  }

  $effect(() => {
    void filesCwd;
    void workspace.revision;
    void workspace.status;
    void refreshFiles();
  });

  function filesNavigate(dir: string) {
    filesCwd = dir;
    filesSelected = null;
  }

  function filesOpenEntry(entry: { name: string; kind: "file" | "directory" }) {
    const path = joinPath(filesCwd, entry.name);
    if (entry.kind === "directory") {
      filesNavigate(path);
    } else {
      void editorSession.open(path);
    }
  }

  async function filesNewFile() {
    const name = window.prompt("New file name", "untitled.txt");
    if (!name) return;
    try {
      await workspace.createFile(joinPath(filesCwd, name));
      filesSelected = name;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesNewFolder() {
    const name = window.prompt("New folder name", "New Folder");
    if (!name) return;
    try {
      await workspace.createDir(joinPath(filesCwd, name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesRename() {
    if (!filesSelected) return;
    const newName = window.prompt("Rename to", filesSelected);
    if (!newName || newName === filesSelected) return;
    try {
      await workspace.rename(joinPath(filesCwd, filesSelected), joinPath(filesCwd, newName));
      filesSelected = newName;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesDelete() {
    if (!filesSelected) return;
    if (!window.confirm(`Delete “${filesSelected}”? This cannot be undone.`)) return;
    try {
      await workspace.remove(joinPath(filesCwd, filesSelected));
      filesSelected = null;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const statusLabel = $derived(
    workspace.status === "connected"
      ? "Connected"
      : workspace.status === "connecting" || workspace.restoring
        ? "Connecting..."
        : "Not connected",
  );
</script>

<div class="files-app flex h-full flex-col gap-3 p-4">
  <div class="app-toolbar flex items-start justify-between gap-3">
    <div class="flex flex-col gap-1">
      <Badge variant="secondary" class="w-fit">{statusLabel}</Badge>
      <h1 class="text-lg font-semibold">Files</h1>
    </div>
    {#if workspace.status === "connected"}
      <div class="files-toolbar flex flex-wrap gap-1">
        <Button variant="outline" size="sm" onclick={filesNewFile}>
          <FilePlusIcon data-icon="inline-start" />
          New
        </Button>
        <Button variant="outline" size="sm" onclick={filesNewFolder}>
          <FolderPlusIcon data-icon="inline-start" />
          New
        </Button>
        <Button variant="outline" size="icon-sm" onclick={filesRename} disabled={!filesSelected}>
          <PencilIcon />
        </Button>
        <Button
          variant="destructive"
          size="icon-sm"
          onclick={filesDelete}
          disabled={!filesSelected}
        >
          <Trash2Icon />
        </Button>
      </div>
    {/if}
  </div>

  {#if workspace.status !== "connected"}
    <Empty.Root class="flex-1 border">
      <Empty.Header>
        {#if workspace.status === "connecting" || workspace.restoring}
          <Empty.Media variant="icon"><Spinner /></Empty.Media>
          <Empty.Title>{workspace.restoring ? "Loading workspace..." : "Connecting..."}</Empty.Title>
        {:else}
          <Empty.Title>No workspace connected.</Empty.Title>
          <Empty.Description>
            Connect once — your files stay available after reload until you disconnect.
          </Empty.Description>
        {/if}
      </Empty.Header>
      {#if workspace.status !== "connecting" && !workspace.restoring}
        <Empty.Content>
          <Button onclick={connectWorkspace}>Connect workspace</Button>
        </Empty.Content>
      {/if}
    </Empty.Root>
  {:else}
    <Breadcrumb.Root>
      <Breadcrumb.List>
        {#each breadcrumbs(filesCwd) as crumb, i}
          {#if i > 0}<Breadcrumb.Separator />{/if}
          <Breadcrumb.Item>
            {#if i === breadcrumbs(filesCwd).length - 1}
              <Breadcrumb.Page>{crumb.name}</Breadcrumb.Page>
            {:else}
              <Breadcrumb.Link href="#{crumb.path}" onclick={(e) => { e.preventDefault(); filesNavigate(crumb.path); }}>
                {crumb.name}
              </Breadcrumb.Link>
            {/if}
          </Breadcrumb.Item>
        {/each}
      </Breadcrumb.List>
    </Breadcrumb.Root>

    {#if filesLoading}
      <div class="files-empty flex flex-1 items-center justify-center gap-2">
        <Spinner />
        <p>Loading…</p>
      </div>
    {:else if filesError}
      <Empty.Root class="flex-1 border">
        <Empty.Header>
          <Empty.Title class="text-destructive">{filesError}</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else if filesEntries.length === 0}
      <Empty.Root class="flex-1 border">
        <Empty.Header>
          <Empty.Title>This folder is empty.</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ScrollArea class="min-h-0 flex-1">
        <div class="files-list flex flex-col gap-1 pr-3">
          {#each filesEntries as entry (entry.name)}
            <Button
              variant="ghost"
              class={cn(
                "file-row h-auto w-full justify-start gap-3 px-3 py-2",
                filesSelected === entry.name && "bg-muted",
              )}
              onclick={() => (filesSelected = entry.name)}
              ondblclick={() => filesOpenEntry(entry)}
            >
              <span class="file-row-icon text-lg">
                {entry.kind === "directory" ? "📁" : iconForFile(entry.name)}
              </span>
              <span class="file-row-name flex-1 truncate text-left">{entry.name}</span>
              <span class="file-row-meta text-muted-foreground text-xs">
                {entry.kind === "directory" ? "Folder" : formatSize(entry.size)}
              </span>
            </Button>
          {/each}
        </div>
      </ScrollArea>
    {/if}
  {/if}
</div>
