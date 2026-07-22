/** OPFS-backed model and audio blob storage. */

export type ModelFileRecord = {
  id: string;
  providerId: string;
  name: string;
  variant: string;
  quantization: string;
  version: string;
  downloadUrl?: string;
  expectedBytes: number;
  checksumSha256?: string;
  installedBytes?: number;
  checksumOk?: boolean;
  installedAt?: number;
  lastUsedAt?: number;
  path: string;
};

/**
 * On-disk container format. Drives the runtime adapter selection:
 *  - "onnx" → ONNX Runtime Web (WebGPU executor preferred, WASM fallback)
 *  - "gguf" → llama.cpp-omni / VoxCPM.cpp WASM (future milestone)
 * Omitting `format` is treated as "gguf" for backward compatibility with
 * pre-existing GGUF-only consumers.
 */
export type ModelFormat = "onnx" | "gguf";

export type ModelManifest = {
  providerId: string;
  models: Array<{
    id: string;
    name: string;
    variant: string;
    quantization: string;
    version: string;
    downloadUrl: string;
    bytes: number;
    sha256?: string;
    required: boolean;
    role: "baselm" | "acoustic" | "tokenizer" | "other";
    format?: ModelFormat;
    /**
     * Subgraph name when an ONNX model packs multiple components in one file
     * (e.g. a VoxCPM2 bundle containing baseLM + flow-matching + AudioVAE V2).
     * GGUF entries leave this unset.
     */
    subgraph?: string;
    /**
     * Whether the artifact at `downloadUrl` is actually published.
     *  - "available": the URL is live and the file can be fetched now.
     *  - "pending":   the URL is a placeholder; the artifact has not been
     *                  exported/uploaded yet. The UI MUST treat pending models
     *                  as non-downloadable and explain why, rather than letting
     *                  the user click into a guaranteed 401.
     */
    availability?: "available" | "pending";
  }>;
};

/**
 * Derive the on-disk filename for a manifest entry. Matches the convention
 * used by `providerModelManager` (`${id}.gguf`) and extends it for the ONNX
 * path. The filename is what lives under OPFS `models/`.
 */
export function modelFilename(model: ModelManifest["models"][number]): string {
  const ext = model.format === "onnx" ? "onnx" : "gguf";
  return `${model.id}.${ext}`;
}

/**
 * Resolve a manifest model id to its OPFS-relative path (`models/<filename>`).
 * Returns null if the id is not present in the manifest.
 */
export function resolveModelFile(
  manifest: ModelManifest,
  modelId: string,
): { filename: string; opfsPath: string; format: ModelFormat } | null {
  const model = manifest.models.find((m) => m.id === modelId);
  if (!model) return null;
  const filename = modelFilename(model);
  const format = model.format ?? "gguf";
  return { filename, opfsPath: `models/${filename}`, format };
}

const ROOT = "tts-studio";

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(ROOT, { create: true });
}

async function getDir(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

export async function ensureStorageLayout(): Promise<{
  models: FileSystemDirectoryHandle;
  audio: FileSystemDirectoryHandle;
  refs: FileSystemDirectoryHandle;
  tmp: FileSystemDirectoryHandle;
}> {
  const root = await getRoot();
  return {
    models: await getDir(root, "models"),
    audio: await getDir(root, "audio"),
    refs: await getDir(root, "refs"),
    tmp: await getDir(root, "tmp"),
  };
}

export async function opfsAvailable(): Promise<boolean> {
  try {
    if (!("storage" in navigator) || !navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

export async function estimateStorage(): Promise<{
  usage?: number;
  quota?: number;
}> {
  if (!navigator.storage?.estimate) return {};
  const est = await navigator.storage.estimate();
  return { usage: est.usage, quota: est.quota };
}

export async function writeOpfsFile(
  dir: "models" | "audio" | "refs" | "tmp",
  filename: string,
  data: ArrayBuffer | Blob | Uint8Array,
): Promise<string> {
  const layout = await ensureStorageLayout();
  const handle = await layout[dir].getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const chunk =
    data instanceof Blob
      ? data
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  await writable.write(chunk as Blob | BufferSource);
  await writable.close();
  return `${dir}/${filename}`;
}

export type GgufValidationResult =
  | { ok: true; version: number }
  | { ok: false; error: string };

/** Validate the small, fixed GGUF header without reading the model into memory. */
export async function validateGgufBlob(blob: Blob): Promise<GgufValidationResult> {
  if (blob.size < 8) {
    return { ok: false, error: "The selected file is too small to be a GGUF model." };
  }

  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (header[0] !== 0x47 || header[1] !== 0x47 || header[2] !== 0x55 || header[3] !== 0x46) {
    return { ok: false, error: "The selected file does not have a valid GGUF header." };
  }

  const version = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, true);
  if (version < 2 || version > 3) {
    return { ok: false, error: `Unsupported GGUF version ${version}. Expected version 2 or 3.` };
  }

  return { ok: true, version };
}

/**
 * Stream a user-selected model into OPFS. `createWritable()` commits on close,
 * so a cancelled or failed import does not replace a previously installed
 * model with a partial file.
 */
export async function importBlobToOpfs(options: {
  file: Blob;
  filename: string;
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ path: string; bytes: number }> {
  const layout = await ensureStorageLayout();
  const handle = await layout.models.getFileHandle(options.filename, { create: true });

  let previousBytes = 0;
  try {
    previousBytes = (await handle.getFile()).size;
  } catch {
    // Newly-created files may not expose metadata until their first write.
  }

  const estimate = await estimateStorage();
  if (estimate.quota !== undefined && estimate.usage !== undefined) {
    const available = Math.max(0, estimate.quota - estimate.usage);
    const additionalBytes = Math.max(0, options.file.size - previousBytes);
    if (additionalBytes > available) {
      throw new Error(
        `Not enough browser storage. The import needs ${Math.ceil(additionalBytes / 1e6)} MB ` +
          `but only ${Math.floor(available / 1e6)} MB is available.`,
      );
    }
  }

  const writable = await handle.createWritable();
  const reader = options.file.stream().getReader();
  let received = 0;

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("Import cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.byteLength;
      options.onProgress?.(received, options.file.size);
    }
    await writable.close();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writable.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return { path: `models/${options.filename}`, bytes: received };
}

export async function readOpfsFile(
  dir: "models" | "audio" | "refs" | "tmp",
  filename: string,
): Promise<ArrayBuffer> {
  const layout = await ensureStorageLayout();
  const handle = await layout[dir].getFileHandle(filename);
  const file = await handle.getFile();
  return file.arrayBuffer();
}

/**
 * Returns the `FileSystemFileHandle` for a stored file, without reading it.
 * Used by runtime adapters that need to transfer the handle to a Worker or
 * to ONNX Runtime Web's `InferenceSession.createFromFile` path, avoiding a
 * multi-GB copy through the JS heap.
 */
export async function getOpfsFileHandle(
  dir: "models" | "audio" | "refs" | "tmp",
  filename: string,
): Promise<FileSystemFileHandle> {
  const layout = await ensureStorageLayout();
  return layout[dir].getFileHandle(filename);
}

export async function deleteOpfsFile(
  dir: "models" | "audio" | "refs" | "tmp",
  filename: string,
): Promise<void> {
  const layout = await ensureStorageLayout();
  await layout[dir].removeEntry(filename);
}

export async function listOpfsFiles(
  dir: "models" | "audio" | "refs" | "tmp",
): Promise<string[]> {
  const layout = await ensureStorageLayout();
  const names: string[] = [];
  for await (const [name, handle] of layout[dir].entries()) {
    if (handle.kind === "file") names.push(name);
  }
  return names;
}

/** Resume-friendly download into OPFS with optional Range requests. */
export async function downloadToOpfs(options: {
  url: string;
  filename: string;
  expectedBytes?: number;
  onProgress?: (received: number, total?: number) => void;
  signal?: AbortSignal;
}): Promise<{ path: string; bytes: number }> {
  const layout = await ensureStorageLayout();
  const partName = `${options.filename}.part`;
  let existing = 0;

  try {
    const part = await layout.models.getFileHandle(partName);
    const file = await part.getFile();
    existing = file.size;
  } catch {
    existing = 0;
  }

  const headers: HeadersInit = {};
  if (existing > 0) headers.Range = `bytes=${existing}-`;

  const res = await fetch(options.url, { headers, signal: options.signal });
  if (!(res.ok || res.status === 206)) {
    throw new Error(`Download failed (${res.status})`);
  }

  const totalHeader = res.headers.get("Content-Length");
  const total = options.expectedBytes
    ?? (totalHeader ? existing + Number(totalHeader) : undefined);

  const handle = await layout.models.getFileHandle(partName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: true });
  if (existing > 0 && res.status === 206) {
    await writable.seek(existing);
  } else {
    existing = 0;
    await writable.seek(0);
    await writable.truncate(0);
  }

  if (!res.body) throw new Error("Download response has no body");
  const reader = res.body.getReader();
  let received = existing;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writable.write(value);
    received += value.byteLength;
    options.onProgress?.(received, total);
  }
  await writable.close();

  // Promote .part → final without materialising a multi-GB model in the JS heap.
  const partFile = await (await layout.models.getFileHandle(partName)).getFile();
  const finalHandle = await layout.models.getFileHandle(options.filename, { create: true });
  const finalWritable = await finalHandle.createWritable();
  const partReader = partFile.stream().getReader();
  try {
    while (true) {
      const { done, value } = await partReader.read();
      if (done) break;
      await finalWritable.write(value);
    }
    await finalWritable.close();
  } catch (error) {
    await partReader.cancel().catch(() => undefined);
    await finalWritable.abort().catch(() => undefined);
    throw error;
  } finally {
    partReader.releaseLock();
  }
  await layout.models.removeEntry(partName);

  return { path: `models/${options.filename}`, bytes: received };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateManifest(manifest: ModelManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.providerId) errors.push("Manifest missing providerId");
  if (!Array.isArray(manifest.models) || !manifest.models.length) {
    errors.push("Manifest has no models");
  }
  for (const m of manifest.models ?? []) {
    if (!m.id || !m.name || !m.downloadUrl) {
      errors.push(`Invalid model entry: ${m.id || "(missing id)"}`);
    }
    if (m.bytes <= 0) errors.push(`Model ${m.id} has invalid size`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * VoxCPM2 model manifest (user must confirm before download).
 *
 * Artifacts are the real CrispASR-published GGUF files at
 * https://huggingface.co/cstr/voxcpm2-GGUF. Unlike the earlier split-baselm/
 * acoustic fiction, CrispASR ships a single all-in-one GGUF that the WASM
 * runtime loads via `ttsOpenExplicit(path, "voxcpm2-tts", threads)`.
 *
 * Three quantizations are offered; the Q4_K (~1.5 GB) is the recommended
 * default for browser use, balancing quality and download size. Output is
 * 48 kHz mono PCM. Supports 30 languages including `km` (Khmer).
 *
 * The `role: "other"` + `format: "gguf"` signals to the runtime factory that
 * these are CrispASR-style single-file models, not the old split pair.
 */
export const VOXCPM2_MANIFEST: ModelManifest = {
  providerId: "voxcpm2",
  models: [
    {
      id: "voxcpm2-q4_k",
      name: "VoxCPM2 (Q4_K, recommended)",
      variant: "Full",
      quantization: "Q4_K",
      version: "2.0",
      format: "gguf",
      downloadUrl:
        "https://huggingface.co/cstr/voxcpm2-GGUF/resolve/main/voxcpm2-q4_k.gguf",
      bytes: 1_500_000_000,
      required: true,
      role: "other",
      availability: "available",
    },
    {
      id: "voxcpm2-q8_0",
      name: "VoxCPM2 (Q8_0, higher quality)",
      variant: "Full",
      quantization: "Q8_0",
      version: "2.0",
      format: "gguf",
      downloadUrl:
        "https://huggingface.co/cstr/voxcpm2-GGUF/resolve/main/voxcpm2-q8_0.gguf",
      bytes: 2_830_000_000,
      required: false,
      role: "other",
      availability: "available",
    },
    {
      id: "voxcpm2-f16",
      name: "VoxCPM2 (F16, full precision)",
      variant: "Full",
      quantization: "F16",
      version: "2.0",
      format: "gguf",
      downloadUrl:
        "https://huggingface.co/cstr/voxcpm2-GGUF/resolve/main/voxcpm2-f16.gguf",
      bytes: 4_630_000_000,
      required: false,
      role: "other",
      availability: "available",
    },
  ],
};
