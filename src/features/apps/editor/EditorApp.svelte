<script lang="ts">
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import SaveIcon from "@lucide/svelte/icons/save";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Empty from "$lib/components/ui/empty/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { workspace } from "@/domains/workspace";
  import { iconForFile } from "@/shared/lib/format";
  import { connectWorkspace } from "@/features/desktop/workspace-actions";
  import { editorSession } from "./editor-session.svelte";
</script>

<div class="editor-app flex h-full flex-col gap-3 p-4">
  <div class="app-toolbar flex items-start justify-between gap-3">
    <div class="flex flex-col gap-1">
      <Badge variant="secondary" class="w-fit max-w-full truncate">
        {editorSession.path ?? "Unsaved"}
      </Badge>
      <h1 class="flex items-center gap-2 text-lg font-semibold">
        Editor
        {#if editorSession.dirty}
          <span class="text-primary text-sm" title="Unsaved changes">●</span>
        {/if}
      </h1>
    </div>
    <div class="editor-toolbar flex gap-1">
      <Button variant="outline" size="sm" onclick={() => editorSession.createNew()}>
        <FilePlusIcon data-icon="inline-start" />
        New
      </Button>
      <Button
        size="sm"
        onclick={() => editorSession.save()}
        disabled={!editorSession.path || !editorSession.dirty}
      >
        <SaveIcon data-icon="inline-start" />
        Save
      </Button>
    </div>
  </div>

  {#if workspace.status !== "connected"}
    <Empty.Root class="flex-1 border">
      <Empty.Header>
        {#if workspace.status === "connecting" || workspace.restoring}
          <Empty.Media variant="icon"><Spinner /></Empty.Media>
          <Empty.Title>{workspace.restoring ? "Loading workspace..." : "Connecting..."}</Empty.Title>
        {:else}
          <Empty.Title>Connect the workspace to edit files.</Empty.Title>
        {/if}
      </Empty.Header>
      {#if workspace.status !== "connecting" && !workspace.restoring}
        <Empty.Content>
          <Button onclick={connectWorkspace}>Connect workspace</Button>
        </Empty.Content>
      {/if}
    </Empty.Root>
  {:else if !editorSession.path && editorSession.recent.length === 0}
    <Empty.Root class="flex-1 border">
      <Empty.Header>
        <Empty.Title>No file open.</Empty.Title>
      </Empty.Header>
      <Empty.Content>
        <Button onclick={() => editorSession.createNew()}>New file</Button>
      </Empty.Content>
    </Empty.Root>
  {:else if !editorSession.path}
    <div class="editor-recent flex flex-col gap-2">
      <Badge variant="outline" class="w-fit">Recent</Badge>
      {#each editorSession.recent as path}
        <Button
          variant="ghost"
          class="h-auto w-full justify-start gap-3 px-3 py-2"
          onclick={() => editorSession.open(path)}
        >
          <span class="text-lg">{iconForFile(path)}</span>
          <span class="truncate">{path}</span>
        </Button>
      {/each}
    </div>
  {:else}
    <Textarea
      class="editor-textarea min-h-0 flex-1 resize-none font-mono text-sm"
      bind:value={editorSession.content}
      oninput={() => editorSession.markDirty()}
      onkeydown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          void editorSession.save();
        }
      }}
      spellcheck="false"
      aria-label="File content"
    />
  {/if}
</div>
