import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { toast } from "@/shared/lib/toast.svelte";
import { workspace } from "@/domains/workspace";
import { windowManager } from "./window-manager.svelte";

export function openWorkspaceSettings() {
  windowManager.open("settings");
  window.setTimeout(() => {
    document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" });
  }, 80);
}

export async function connectWorkspace() {
  const ok = await workspace.connect();
  if (ok) {
    toast.show("Workspace connected — stays active after reload");
  } else if (workspace.error) {
    toast.error(`Workspace error: ${workspace.error}`);
  } else {
    toast.show("Workspace not connected");
  }
  return ok;
}

export async function disconnectWorkspace() {
  await workspace.disconnect();
  toast.show("Workspace disconnected — files cleared from this browser");
}

/** Forget persisted handle and bind flags so a fresh connect starts clean. */
export function resetWorkspaceState() {
  localStorage.removeItem(STORAGE_KEYS.workspaceSeeded);
  localStorage.removeItem(STORAGE_KEYS.workspaceBound);
  workspace.disconnect().then(() => {
    toast.show("Workspace state reset — click Connect to start fresh");
  });
}
