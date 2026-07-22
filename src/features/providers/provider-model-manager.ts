import {
  downloadToOpfs,
  estimateStorage,
  listOpfsFiles,
  deleteOpfsFile,
  importBlobToOpfs,
  validateGgufBlob,
  validateManifest,
  VOXCPM2_MANIFEST,
  modelFilename,
  type ModelFileRecord,
  type ModelManifest,
} from "@nd-os/model-storage";

export type DownloadState = {
  modelId: string;
  status: "idle" | "downloading" | "importing" | "paused" | "completed" | "error";
  received: number;
  total?: number;
  error?: string;
};

const installed = new Map<string, ModelFileRecord>();
const downloads = new Map<string, DownloadState>();
let abortControllers = new Map<string, AbortController>();

export const providerModelManager = {
  getManifest(providerId: string): ModelManifest | null {
    if (providerId === "voxcpm2") return VOXCPM2_MANIFEST;
    return null;
  },

  listInstalled(): ModelFileRecord[] {
    return [...installed.values()];
  },

  getDownloadState(modelId: string): DownloadState | undefined {
    return downloads.get(modelId);
  },

  async refreshInstalled(providerId: string) {
    const files = await listOpfsFiles("models");
    const manifest = this.getManifest(providerId);
    if (!manifest) return;

    // Prefer file metadata only — never pull multi-GB GGUF into the JS heap.
    const { ensureStorageLayout } = await import("@nd-os/model-storage");
    const layout = await ensureStorageLayout();

    for (const model of manifest.models) {
      const filename = modelFilename(model);
      if (!files.includes(filename)) {
        installed.delete(model.id);
        continue;
      }
      const handle = await layout.models.getFileHandle(filename);
      const file = await handle.getFile();
      installed.set(model.id, {
        id: model.id,
        providerId,
        name: model.name,
        variant: model.variant,
        quantization: model.quantization,
        version: model.version,
        downloadUrl: model.downloadUrl,
        expectedBytes: model.bytes,
        installedBytes: file.size,
        checksumSha256: model.sha256,
        // Full checksum deferred — hashing multi-GB in main thread freezes UI.
        checksumOk: undefined,
        path: `models/${filename}`,
        installedAt: file.lastModified || Date.now(),
        lastUsedAt: undefined,
      });
    }
  },

  isInstalled(modelId: string): boolean {
    return installed.has(modelId);
  },

  getInstalled(modelId: string): ModelFileRecord | undefined {
    return installed.get(modelId);
  },

  async areRequiredModelsInstalled(providerId: string): Promise<boolean> {
    await this.refreshInstalled(providerId);
    const manifest = this.getManifest(providerId);
    if (!manifest) return false;
    return manifest.models.filter((m) => m.required).every((m) => installed.has(m.id));
  },

  async startDownload(providerId: string, modelId: string) {
    const manifest = this.getManifest(providerId);
    if (!manifest) throw new Error("Unknown provider manifest");
    const validation = validateManifest(manifest);
    if (!validation.ok) throw new Error(validation.errors.join("; "));

    const model = manifest.models.find((m) => m.id === modelId);
    if (!model) throw new Error("Model not found in manifest");
    if (model.availability === "pending") {
      throw new Error(
        "This ONNX artifact has not been exported yet. Run scripts/export_voxcpm2_to_onnx.py " +
          "to produce it, upload it to the manifest's downloadUrl, then set availability: \"available\".",
      );
    }

    const controller = new AbortController();
    abortControllers.set(modelId, controller);
    downloads.set(modelId, {
      modelId,
      status: "downloading",
      received: 0,
      total: model.bytes,
    });

    try {
      const result = await downloadToOpfs({
        url: model.downloadUrl,
        filename: modelFilename(model),
        expectedBytes: model.bytes,
        signal: controller.signal,
        onProgress: (received, total) => {
          downloads.set(modelId, {
            modelId,
            status: "downloading",
            received,
            total,
          });
        },
      });

      installed.set(modelId, {
        id: model.id,
        providerId,
        name: model.name,
        variant: model.variant,
        quantization: model.quantization,
        version: model.version,
        downloadUrl: model.downloadUrl,
        expectedBytes: model.bytes,
        installedBytes: result.bytes,
        path: result.path,
        installedAt: Date.now(),
      });
      downloads.set(modelId, {
        modelId,
        status: "completed",
        received: result.bytes,
        total: model.bytes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      downloads.set(modelId, {
        modelId,
        status: "error",
        received: downloads.get(modelId)?.received ?? 0,
        total: model.bytes,
        error: message,
      });
      throw err;
    } finally {
      abortControllers.delete(modelId);
    }
  },

  async importModel(providerId: string, modelId: string, file: File) {
    const manifest = this.getManifest(providerId);
    if (!manifest) throw new Error("Unknown provider manifest");

    const model = manifest.models.find((entry) => entry.id === modelId);
    if (!model) throw new Error("Model not found in manifest");
    if ((model.format ?? "gguf") !== "gguf") {
      throw new Error("This model slot only accepts its published non-GGUF artifact.");
    }
    if (!file.name.toLowerCase().endsWith(".gguf")) {
      throw new Error("Choose a .gguf VoxCPM2 model file.");
    }

    const validation = await validateGgufBlob(file);
    if (!validation.ok) throw new Error(validation.error);

    const controller = new AbortController();
    abortControllers.set(modelId, controller);
    downloads.set(modelId, {
      modelId,
      status: "importing",
      received: 0,
      total: file.size,
    });

    try {
      const result = await importBlobToOpfs({
        file,
        filename: modelFilename(model),
        signal: controller.signal,
        onProgress: (received, total) => {
          downloads.set(modelId, {
            modelId,
            status: "importing",
            received,
            total,
          });
        },
      });

      installed.set(modelId, {
        id: model.id,
        providerId,
        name: model.name,
        variant: model.variant,
        quantization: model.quantization,
        version: model.version,
        downloadUrl: model.downloadUrl,
        expectedBytes: model.bytes,
        installedBytes: result.bytes,
        checksumOk: true,
        path: result.path,
        installedAt: Date.now(),
      });
      downloads.set(modelId, {
        modelId,
        status: "completed",
        received: result.bytes,
        total: file.size,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      downloads.set(modelId, {
        modelId,
        status: "error",
        received: downloads.get(modelId)?.received ?? 0,
        total: file.size,
        error: message,
      });
      throw err;
    } finally {
      abortControllers.delete(modelId);
    }
  },

  pauseDownload(modelId: string) {
    abortControllers.get(modelId)?.abort();
    const current = downloads.get(modelId);
    if (current) {
      downloads.set(modelId, { ...current, status: "paused" });
    }
  },

  async deleteModel(modelId: string) {
    const manifest = this.getManifest("voxcpm2");
    const model = manifest?.models.find((m) => m.id === modelId);
    const filename = model ? modelFilename(model) : `${modelId}.gguf`;
    await deleteOpfsFile("models", filename);
    installed.delete(modelId);
    downloads.delete(modelId);
  },

  async storageEstimate() {
    return estimateStorage();
  },
};
