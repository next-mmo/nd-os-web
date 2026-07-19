// File System Access API backend (Chromium).
//
// Stores a root FileSystemDirectoryHandle in IndexedDB so the chosen folder
// survives reloads; each new session still needs a one-click permission re-grant
// (browser policy), but the folder doesn't have to be re-picked.

import type { Entry, WorkspaceImpl } from "./types";

const HANDLE_DB = "nd-os-workspace";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "root";

// --- minimal FileSystemDirectoryHandle typing (TS lib may not include FSA) ---
type FSPermissionMode = "read" | "readwrite";
interface FSQueryPermissionOpts {
  mode?: FSPermissionMode;
}
interface FSRequestPermissionOpts {
  mode: FSPermissionMode;
}
interface FSDirHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<FSDirHandle | FSFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FSDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FSFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  queryPermission?(opts: FSQueryPermissionOpts): Promise<PermissionState>;
  requestPermission?(opts: FSRequestPermissionOpts): Promise<PermissionState>;
}
interface FSFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}
interface WindowWithPicker {
  showDirectoryPicker?(opts?: { mode?: FSPermissionMode }): Promise<FSDirHandle>;
}

// --- handle persistence (IndexedDB) ---
function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRootHandle(handle: FSDirHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // Silently proceed so storing the handle doesn't crash the connection event.
    // Incognito mode or custom flags can block directory handles in IndexedDB.
    console.error("[workspace] Failed to persist directory handle to IndexedDB:", err);
  }
}

export async function loadRootHandle(): Promise<FSDirHandle | null> {
  try {
    const db = await openHandleDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, "readonly");
        const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
        req.onsuccess = () => resolve((req.result as FSDirHandle) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.error("[workspace] Failed to load directory handle from IndexedDB:", err);
    return null;
  }
}

export async function clearRootHandle(): Promise<void> {
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error("[workspace] Failed to clear directory handle from IndexedDB:", err);
  }
}

// --- path helpers ---
function splitPath(path: string): string[] {
  return path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getDir(root: FSDirHandle, segments: string[], create = false): Promise<FSDirHandle> {
  let dir = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir;
}

async function getParentAndName(
  root: FSDirHandle,
  path: string,
  create = false,
): Promise<{ parent: FSDirHandle; name: string }> {
  const segments = splitPath(path);
  if (segments.length === 0) throw new Error("Cannot operate on root");
  const name = segments.pop()!;
  const parent = await getDir(root, segments, create);
  return { parent, name };
}

// --- public impl ---
export const fsaBackend: WorkspaceImpl = {
  async pickRoot(): Promise<boolean> {
    const w = window as unknown as WindowWithPicker;
    if (!w.showDirectoryPicker) return false;
    try {
      // Call showDirectoryPicker without parameters for widest browser compatibility.
      const handle = await w.showDirectoryPicker();
      
      // Request write permission explicitly on the handle.
      if (handle.requestPermission) {
        const state = await handle.requestPermission({ mode: "readwrite" });
        if (state !== "granted") {
          console.warn("[workspace] Permission was not granted for picker handle:", state);
          return false;
        }
      }
      
      await saveRootHandle(handle);
      return true;
    } catch (err) {
      console.error("[workspace] showDirectoryPicker or permission request failed:", err);
      throw err;
    }
  },

  async hasStoredRoot(): Promise<boolean> {
    try {
      return (await loadRootHandle()) !== null;
    } catch (err) {
      console.error("[workspace] hasStoredRoot failed:", err);
      return false;
    }
  },

  async clearRoot(): Promise<void> {
    await clearRootHandle();
  },

  async ensurePermission(): Promise<boolean> {
    return this.requestPermissionIfNeeded();
  },

  /**
   * Query-only permission check — safe to call on load without a user gesture.
   * Returns true only if permission is already "granted"; never prompts.
   */
  async hasPermissionGranted(): Promise<boolean> {
    const root = await loadRootHandle();
    if (!root) return false;
    const opts = { mode: "readwrite" as FSPermissionMode };
    if (root.queryPermission) {
      return (await root.queryPermission(opts)) === "granted";
    }
    return false;
  },

  /**
   * Request permission if needed. MUST be called from a user-gesture handler
   * (button click) — requestPermission silently fails otherwise.
   */
  async requestPermissionIfNeeded(): Promise<boolean> {
    const root = await loadRootHandle();
    if (!root) return false;
    const opts = { mode: "readwrite" as FSPermissionMode };
    if (root.queryPermission) {
      const state = await root.queryPermission(opts);
      if (state === "granted") return true;
    }
    if (root.requestPermission) {
      const state = await root.requestPermission(opts);
      return state === "granted";
    }
    return false;
  },

  async list(path: string): Promise<Entry[]> {
    const root = await loadRootHandle();
    if (!root) throw new Error("Workspace not connected");
    const dir = await getDir(root, splitPath(path));
    const entries: Entry[] = [];
    for await (const handle of dir.values()) {
      if (handle.kind === "file") {
        const file = await (handle as FSFileHandle).getFile();
        entries.push({ name: handle.name, kind: "file", size: file.size });
      } else {
        entries.push({ name: handle.name, kind: "directory" });
      }
    }
    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  async readFile(path: string): Promise<string> {
    const root = await loadRootHandle();
    if (!root) throw new Error("Workspace not connected");
    const { parent, name } = await getParentAndName(root, path);
    const fileHandle = await parent.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
  },

  async writeFile(path: string, content: string): Promise<void> {
    const root = await loadRootHandle();
    if (!root) throw new Error("Workspace not connected");
    const { parent, name } = await getParentAndName(root, path, true);
    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  },

  async createFile(path: string): Promise<void> {
    await this.writeFile(path, "");
  },

  async createDir(path: string): Promise<void> {
    const root = await loadRootHandle();
    if (!root) throw new Error("Workspace not connected");
    await getDir(root, splitPath(path), true);
  },

  async remove(path: string): Promise<void> {
    const root = await loadRootHandle();
    if (!root) throw new Error("Workspace not connected");
    const { parent, name } = await getParentAndName(root, path);
    // FSA doesn't tell us file vs dir at this layer; try recursive to be safe.
    await parent.removeEntry(name, { recursive: true });
  },

  async rename(oldPath: string, newPath: string): Promise<void> {
    // FSA has no atomic rename across handles, so copy + delete.
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.remove(oldPath);
  },
};
