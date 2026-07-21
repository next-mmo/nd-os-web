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
  }>;
};

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

export async function readOpfsFile(
  dir: "models" | "audio" | "refs" | "tmp",
  filename: string,
): Promise<ArrayBuffer> {
  const layout = await ensureStorageLayout();
  const handle = await layout[dir].getFileHandle(filename);
  const file = await handle.getFile();
  return file.arrayBuffer();
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

  // Promote .part → final
  const partFile = await (await layout.models.getFileHandle(partName)).getFile();
  const finalHandle = await layout.models.getFileHandle(options.filename, { create: true });
  const finalWritable = await finalHandle.createWritable();
  await finalWritable.write(await partFile.arrayBuffer());
  await finalWritable.close();
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

/** Official VoxCPM2 GGUF manifest (user must confirm before download). */
export const VOXCPM2_MANIFEST: ModelManifest = {
  providerId: "voxcpm2",
  models: [
    {
      id: "voxcpm2-baselm-q8",
      name: "VoxCPM2 BaseLM",
      variant: "BaseLM",
      quantization: "Q8_0",
      version: "2.0",
      downloadUrl:
        "https://huggingface.co/DennisHuang648/VoxCPM2-GGUF/resolve/main/VoxCPM2-BaseLM-Q8_0.gguf",
      bytes: 2_200_000_000,
      required: true,
      role: "baselm",
    },
    {
      id: "voxcpm2-acoustic-f16",
      name: "VoxCPM2 Acoustic",
      variant: "Acoustic",
      quantization: "F16",
      version: "2.0",
      downloadUrl:
        "https://huggingface.co/DennisHuang648/VoxCPM2-GGUF/resolve/main/VoxCPM2-Acoustic-F16.gguf",
      bytes: 1_100_000_000,
      required: true,
      role: "acoustic",
    },
  ],
};
