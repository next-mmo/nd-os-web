import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { toast } from "@/shared/lib/toast.svelte";
import { workspace } from "@/domains/workspace";
import { windowManager } from "@/features/desktop/window-manager.svelte";

class EditorSession {
  path = $state<string | null>(null);
  content = $state("");
  dirty = $state(false);
  recent = $state<string[]>(
    JSON.parse(localStorage.getItem(STORAGE_KEYS.editorRecent) ?? "[]"),
  );

  private pushRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 8);
    localStorage.setItem(STORAGE_KEYS.editorRecent, JSON.stringify(this.recent));
  }

  async open(path: string) {
    if (workspace.status !== "connected") {
      toast.show("Connect the workspace first");
      return;
    }
    try {
      this.content = await workspace.readFile(path);
      this.path = path;
      this.dirty = false;
      this.pushRecent(path);
      windowManager.open("editor");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : String(err));
    }
  }

  async save() {
    if (!this.path) return;
    try {
      await workspace.writeFile(this.path, this.content);
      this.dirty = false;
      toast.show("Saved");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : String(err));
    }
  }

  async createNew() {
    const name = window.prompt("New file path", "/Documents/untitled.txt");
    if (!name) return;
    try {
      await workspace.createFile(name);
      await this.open(name);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : String(err));
    }
  }

  markDirty() {
    this.dirty = true;
  }
}

export const editorSession = new EditorSession();
