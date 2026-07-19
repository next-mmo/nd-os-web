// IndexedDB-backed virtual filesystem fallback.
//
// Used on Firefox/Safari where the File System Access API is unavailable.
// Stores entries keyed by POSIX-style absolute path ("/Documents/Notes.md")
// in a single object store. Persistent across reloads, but browser-private.

import type { Entry, WorkspaceImpl } from "./types";

const DB_NAME = "nd-os-workspace-fs";
const STORE = "entries";
const ROOT_SENTINEL = "/";

type StoredEntry = {
  path: string;
  kind: "file" | "directory";
  content?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run a single IDBRequest in its own transaction and resolve to its result. */
async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Run multiple put/deletes in a single transaction, awaiting completion. */
async function runMany(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function normalize(path: string): string {
  return "/" + path.split("/").map((s) => s.trim()).filter(Boolean).join("/");
}

function parentOf(path: string): string {
  const norm = normalize(path);
  const idx = norm.lastIndexOf("/");
  return idx <= 0 ? "/" : norm.slice(0, idx);
}

function basename(path: string): string {
  const norm = normalize(path);
  const idx = norm.lastIndexOf("/");
  return norm.slice(idx + 1);
}

async function get(path: string): Promise<StoredEntry | undefined> {
  const key = path === "/" ? ROOT_SENTINEL : normalize(path);
  return run("readonly", (store) => store.get(key) as IDBRequest<StoredEntry | undefined>);
}

async function getAll(): Promise<StoredEntry[]> {
  return run("readonly", (store) => store.getAll() as IDBRequest<StoredEntry[]>);
}

async function exists(path: string): Promise<boolean> {
  return (await get(path)) !== undefined;
}

async function put(entry: StoredEntry): Promise<void> {
  await runMany("readwrite", (store) => {
    store.put(entry);
  });
}

async function ensureParents(path: string): Promise<void> {
  const segments = normalize(path).split("/").filter(Boolean);
  let acc = "";
  for (const seg of segments.slice(0, -1)) {
    acc += "/" + seg;
    if (!(await exists(acc))) {
      await put({ path: acc, kind: "directory" });
    }
  }
}

export const fallbackBackend: WorkspaceImpl = {
  async pickRoot(): Promise<boolean> {
    if (!(await exists("/"))) {
      await put({ path: ROOT_SENTINEL, kind: "directory" });
    }
    return true;
  },

  async hasStoredRoot(): Promise<boolean> {
    return exists("/");
  },

  async clearRoot(): Promise<void> {
    await runMany("readwrite", (store) => {
      store.clear();
    });
  },

  async ensurePermission(): Promise<boolean> {
    // No permission UX needed; "root exists" is treated as granted.
    return true;
  },

  async hasPermissionGranted(): Promise<boolean> {
    return true;
  },

  async requestPermissionIfNeeded(): Promise<boolean> {
    return true;
  },

  async list(path: string): Promise<Entry[]> {
    const prefix = path === "/" ? "/" : normalize(path);
    const all = await getAll();
    const out: Entry[] = [];
    for (const entry of all) {
      if (entry.path === ROOT_SENTINEL) continue;
      if (parentOf(entry.path) === prefix) {
        out.push({
          name: basename(entry.path),
          kind: entry.kind,
          size: entry.kind === "file" ? (entry.content?.length ?? 0) : undefined,
        });
      }
    }
    return out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  async readFile(path: string): Promise<string> {
    const entry = await get(path);
    if (!entry || entry.kind !== "file") throw new Error(`Not a file: ${path}`);
    return entry.content ?? "";
  },

  async writeFile(path: string, content: string): Promise<void> {
    await ensureParents(path);
    await put({ path: normalize(path), kind: "file", content });
  },

  async createFile(path: string): Promise<void> {
    await this.writeFile(path, "");
  },

  async createDir(path: string): Promise<void> {
    await ensureParents(path);
    await put({ path: normalize(path), kind: "directory" });
  },

  async remove(path: string): Promise<void> {
    const target = normalize(path);
    const all = await getAll();
    const toDelete = all.filter(
      (e) => e.path === target || e.path.startsWith(target + "/"),
    );
    await runMany("readwrite", (store) => {
      for (const e of toDelete) store.delete(e.path);
    });
  },

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldNorm = normalize(oldPath);
    const newNorm = normalize(newPath);
    const all = await getAll();
    const affected = all.filter(
      (e) => e.path === oldNorm || e.path.startsWith(oldNorm + "/"),
    );
    await ensureParents(newNorm);
    await runMany("readwrite", (store) => {
      for (const e of affected) {
        const moved: StoredEntry = { ...e, path: newNorm + e.path.slice(oldNorm.length) };
        store.put(moved);
        store.delete(e.path);
      }
    });
  },
};
