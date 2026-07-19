// Capability detection for the workspace storage backend.
//
// The File System Access API (window.showDirectoryPicker) gives us real files
// on the user's disk, but is Chromium-only. Firefox/Safari fall through to the
// IndexedDB-backed virtual filesystem, which is persistent but browser-private.

export type WorkspaceBackend = "native" | "fallback";

/** True when the File System Access API is available (Chromium browsers). */
export function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Best-available backend for this browser. Native (FSA) wins when present;
 * everything else uses the IndexedDB fallback.
 */
export function detectBackend(): WorkspaceBackend {
  return hasFileSystemAccess() ? "native" : "fallback";
}
