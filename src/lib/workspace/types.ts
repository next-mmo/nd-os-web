// Shared types for the workspace storage layer. Both backends (FSA native and
// IndexedDB fallback) implement WorkspaceImpl, so consumer code never branches
// on backend — it just calls these methods with POSIX-style string paths.

export type EntryKind = "file" | "directory";

export interface Entry {
  name: string;
  kind: EntryKind;
  size?: number;
}

export interface WorkspaceImpl {
  /** Prompt the user to pick a root folder (native only). Returns success. */
  pickRoot(): Promise<boolean>;
  /** True if a root handle/entry was previously persisted. */
  hasStoredRoot(): Promise<boolean>;
  /** Forget the persisted root. */
  clearRoot(): Promise<void>;
  /** Re-request permission for a stored handle. Returns true if writable now. */
  ensurePermission(): Promise<boolean>;
  /** Query-only check; safe without a user gesture. Never prompts. */
  hasPermissionGranted(): Promise<boolean>;
  /** Request permission — must be called from a user gesture. */
  requestPermissionIfNeeded(): Promise<boolean>;
  /** List immediate children of a directory path (e.g. "/Documents"). */
  list(path: string): Promise<Entry[]>;
  /** Read a text file as a string. */
  readFile(path: string): Promise<string>;
  /** Write text content to a file, creating it (and parents) as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Create an empty file. */
  createFile(path: string): Promise<void>;
  /** Create a directory. */
  createDir(path: string): Promise<void>;
  /** Remove a file or directory (recursive). */
  remove(path: string): Promise<void>;
  /** Move/rename a path. */
  rename(oldPath: string, newPath: string): Promise<void>;
}
