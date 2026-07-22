<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert/index.js";
  import { providerModelManager } from "@/features/providers";
  import { studioStore } from "@/features/tts/stores/studio.store.svelte";
  import { VOXCPM2_MANIFEST } from "@nd-os/model-storage";
  import { toast } from "@/shared/lib/toast.svelte";
  import type { ModelFileRecord } from "@nd-os/model-storage";

  let confirmingId = $state<string | null>(null);
  let downloads = $state<Record<string, { received: number; total?: number; status: string }>>({});
  let storageLabel = $state("—");
  let installedMap = $state<Record<string, ModelFileRecord>>({});
  let refreshing = $state(false);
  let importTargetId = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement>();

  function syncTransfer(modelId: string) {
    const state = providerModelManager.getDownloadState(modelId);
    if (!state) return;
    downloads = {
      ...downloads,
      [modelId]: {
        received: state.received,
        total: state.total,
        status: state.status,
      },
    };
  }

  async function refresh() {
    refreshing = true;
    try {
      await providerModelManager.refreshInstalled("voxcpm2");
      const next: Record<string, ModelFileRecord> = {};
      for (const rec of providerModelManager.listInstalled()) {
        next[rec.id] = rec;
      }
      installedMap = next;
      const est = await providerModelManager.storageEstimate();
      if (est.quota) {
        storageLabel = `${((est.usage ?? 0) / 1e9).toFixed(2)} / ${(est.quota / 1e9).toFixed(1)} GB`;
      }
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void refresh();
  });

  async function download(modelId: string) {
    confirmingId = null;
    let tick: number | undefined;
    try {
      tick = window.setInterval(() => syncTransfer(modelId), 400);
      await providerModelManager.startDownload("voxcpm2", modelId);
      syncTransfer(modelId);
      await refresh();
      toast.show("Model installed locally");
      void studioStore.reloadProviderRuntime();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Download failed");
    } finally {
      if (tick !== undefined) window.clearInterval(tick);
    }
  }

  function chooseImport(modelId: string) {
    importTargetId = modelId;
    fileInput?.click();
  }

  async function importGguf(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const modelId = importTargetId;
    input.value = "";
    importTargetId = null;
    if (!file || !modelId) return;

    let tick: number | undefined;
    try {
      downloads = {
        ...downloads,
        [modelId]: { received: 0, total: file.size, status: "importing" },
      };
      tick = window.setInterval(() => syncTransfer(modelId), 200);
      await providerModelManager.importModel("voxcpm2", modelId, file);
      syncTransfer(modelId);
      await refresh();
      toast.show(`${file.name} imported locally`);
      void studioStore.reloadProviderRuntime();
    } catch (err) {
      syncTransfer(modelId);
      toast.show(err instanceof Error ? err.message : "GGUF import failed");
    } finally {
      if (tick !== undefined) window.clearInterval(tick);
    }
  }

  async function remove(modelId: string) {
    if (!confirm("Delete this model from local OPFS storage?")) return;
    await providerModelManager.deleteModel(modelId);
    await refresh();
    toast.show("Model deleted");
    void studioStore.reloadProviderRuntime();
  }

  function formatBytes(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
    return `${n} B`;
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
  <input
    bind:this={fileInput}
    data-testid="voxcpm2-gguf-file"
    class="sr-only"
    type="file"
    accept=".gguf,application/octet-stream"
    onchange={importGguf}
  />
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div>
      <h2 class="text-lg font-semibold">Model Manager</h2>
      <p class="text-muted-foreground text-sm">
        Models are stored in OPFS on this device. Estimated usage: {storageLabel}
      </p>
    </div>
    <Button
      size="sm"
      variant="outline"
      class="rounded-[10px]"
      disabled={refreshing}
      onclick={() => refresh()}
    >
      {refreshing ? "Refreshing…" : "Refresh"}
    </Button>
  </div>

  <Alert>
    <AlertTitle>VoxCPM2 Browser</AlertTitle>
    <AlertDescription>
      GGUF models stay on this device and run through CrispASR's threaded WebGPU backend. The
      runtime rejects CPU fallback, so the status badge only reports ready after WebGPU is selected.
      Download a published model or import an existing local GGUF into the matching quantization slot.
    </AlertDescription>
  </Alert>

  <div class="flex flex-col gap-3">
    {#each VOXCPM2_MANIFEST.models as model}
      {@const dl = downloads[model.id]}
      {@const installed = installedMap[model.id]}
      {@const format = model.format ?? "gguf"}
      {@const isOptional = !model.required}
      {@const isPending = model.availability === "pending"}
      <article
        class="border-border rounded-[12px] border p-4"
        class:opacity-70={isPending}
        data-testid={`model-card-${model.id}`}
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <strong>{model.name}</strong>
              <Badge variant="outline">{model.quantization}</Badge>
              <Badge variant="secondary">{model.variant}</Badge>
              <Badge variant="outline">{format.toUpperCase()}</Badge>
              {#if installed}
                <Badge>Installed</Badge>
              {/if}
              {#if isOptional}
                <Badge variant="secondary">Alternative</Badge>
              {/if}
              {#if isPending}
                <Badge variant="secondary">Pending export</Badge>
              {/if}
            </div>
            <p class="text-muted-foreground mt-1 text-sm">
              {#if installed}
                {formatBytes(installed.installedBytes ?? 0)} on disk · expected ~
                {(model.bytes / 1e9).toFixed(1)} GB · v{model.version} · role: {model.role}
              {:else}
                ~{(model.bytes / 1e9).toFixed(1)} GB · v{model.version} · role: {model.role}
              {/if}
            </p>
            {#if installed}
              <p class="text-muted-foreground mt-0.5 text-xs">
                Path: {installed.path}
              </p>
            {/if}
            {#if isOptional}
              <p class="text-muted-foreground mt-0.5 text-xs">
                Complete alternative quantization. It can run without the recommended Q4_K model.
              </p>
            {/if}
            {#if isPending}
              <p class="text-muted-foreground mt-0.5 text-xs">
                The ONNX export has not been produced yet. Download is disabled until
                <code class="text-xs">scripts/export_voxcpm2_to_onnx.py</code> runs and the
                artifact is uploaded. See the runtime README.
              </p>
            {/if}
          </div>
          <div class="flex flex-wrap gap-2">
            {#if installed}
              {#if confirmingId === model.id}
                <Button size="sm" class="rounded-[10px]" onclick={() => download(model.id)}>
                  Confirm download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="rounded-[10px]"
                  onclick={() => (confirmingId = null)}
                >
                  Cancel
                </Button>
              {:else}
                <Button
                  size="sm"
                  variant="ghost"
                  class="rounded-[10px]"
                  onclick={() => remove(model.id)}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="rounded-[10px]"
                  onclick={() => (confirmingId = model.id)}
                >
                  Reinstall
                </Button>
              {/if}
            {:else if isPending}
              <Button size="sm" variant="outline" class="rounded-[10px]" disabled>
                Pending
              </Button>
            {:else if confirmingId === model.id}
              <Button size="sm" class="rounded-[10px]" onclick={() => download(model.id)}>
                Confirm download
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="rounded-[10px]"
                onclick={() => (confirmingId = null)}
              >
                Cancel
              </Button>
            {:else}
              <Button
                size="sm"
                variant="outline"
                class="rounded-[10px]"
                onclick={() => (confirmingId = model.id)}
              >
                Download
              </Button>
            {/if}
            {#if !isPending}
              <Button
                size="sm"
                variant="outline"
                class="rounded-[10px]"
                data-testid={`import-gguf-${model.id}`}
                disabled={dl?.status === "downloading" || dl?.status === "importing"}
                onclick={() => chooseImport(model.id)}
              >
                Import GGUF
              </Button>
            {/if}
          </div>
        </div>
        {#if confirmingId === model.id}
          <p class="text-muted-foreground mt-2 text-xs">
            This model is large and runs entirely on your device. Performance depends on your GPU,
            RAM, browser, and available storage.
          </p>
        {/if}
        {#if dl && (dl.status === "downloading" || dl.status === "importing")}
          <div class="mt-3 space-y-1">
            <div class="text-muted-foreground flex justify-between text-xs">
              <span>{dl.status === "importing" ? "Importing…" : "Downloading…"}</span>
              <span>
                {(dl.received / 1e6).toFixed(0)} MB
                {dl.total ? `/ ${(dl.total / 1e6).toFixed(0)} MB` : ""}
              </span>
            </div>
            <div class="bg-muted h-2 overflow-hidden rounded-full">
              <div
                class="bg-foreground h-full transition-all"
                style={`width:${dl.total ? Math.min(100, (dl.received / dl.total) * 100) : 10}%`}
              ></div>
            </div>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</div>
