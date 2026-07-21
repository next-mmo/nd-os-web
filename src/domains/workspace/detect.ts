// Workspace storage backend selection.
//
// Durable IndexedDB ("fallback") is the default on every browser so a connected
// workspace survives reloads without a permission re-prompt. The File System
// Access API ("native") still exists for optional disk linking, but browsers
// revoke that permission on every reload — which breaks "stay connected".

export type WorkspaceBackend = "native" | "fallback";

/** True when the File System Access API is available (Chromium browsers). */
export function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Backend used for the active workspace.
 * Always IndexedDB so connect-once persists until the user disconnects.
 */
export function detectBackend(): WorkspaceBackend {
  return "fallback";
}
