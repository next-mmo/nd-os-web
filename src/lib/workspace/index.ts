// Public surface for the workspace storage layer. Apps import from here.
export { workspace } from "./workspace.svelte";
export type { WorkspaceStatus, WorkspaceBackend } from "./workspace.svelte";
export type { Entry, EntryKind, WorkspaceImpl } from "./types";
export { detectBackend, hasFileSystemAccess } from "./detect";
