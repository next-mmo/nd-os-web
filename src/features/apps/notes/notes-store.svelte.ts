import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { toast } from "@/shared/lib/toast.svelte";
import { workspace } from "@/domains/workspace";

export type NoteMeta = {
  id: string;
  title: string;
  updatedAt: number;
};

type LocalNote = NoteMeta & { content: string };

const NOTES_DIR = "/Notes";
const LOCAL_KEY = `${STORAGE_KEYS.notes}-list`;

function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "note";
}

function titleFromContent(content: string, fallback: string): string {
  const line = content.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.replace(/^#\s*/, "").slice(0, 60) || fallback;
}

function pathForId(id: string): string {
  return `${NOTES_DIR}/${id}.md`;
}

class NotesStore {
  notes = $state<NoteMeta[]>([]);
  activeId = $state<string | null>(null);
  content = $state("");
  loading = $state(false);
  saving = $state(false);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  get activeNote(): NoteMeta | null {
    return this.notes.find((n) => n.id === this.activeId) ?? null;
  }

  private readLocal(): LocalNote[] {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) {
        // Migrate legacy single-note localStorage value.
        const legacy = localStorage.getItem(STORAGE_KEYS.notes);
        if (legacy !== null) {
          const id = `note-${Date.now().toString(36)}`;
          const migrated: LocalNote[] = [
            {
              id,
              title: titleFromContent(legacy, "Untitled"),
              content: legacy,
              updatedAt: Date.now(),
            },
          ];
          localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
          return migrated;
        }
        return [];
      }
      const parsed = JSON.parse(raw) as LocalNote[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeLocal(all: LocalNote[]) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  }

  async refresh() {
    this.loading = true;
    try {
      if (workspace.status === "connected") {
        await this.refreshFromWorkspace();
      } else {
        this.refreshFromLocal();
      }
      if (!this.activeId && this.notes.length) {
        await this.open(this.notes[0].id);
      } else if (!this.notes.length) {
        this.activeId = null;
        this.content = "";
      }
    } finally {
      this.loading = false;
    }
  }

  private refreshFromLocal() {
    const all = this.readLocal().sort((a, b) => b.updatedAt - a.updatedAt);
    this.notes = all.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  private async refreshFromWorkspace() {
    try {
      await workspace.createDir(NOTES_DIR);
    } catch {
      // already exists
    }

    // Migrate legacy /Notes.md into the Notes folder once.
    try {
      const legacy = await workspace.readFile("/Notes.md");
      const id = `welcome-${Date.now().toString(36)}`;
      await workspace.writeFile(pathForId(id), legacy);
      try {
        await workspace.remove("/Notes.md");
      } catch {
        // ignore
      }
    } catch {
      // no legacy file
    }

    const entries = await workspace.list(NOTES_DIR);
    const files = entries.filter((e) => e.kind === "file" && e.name.endsWith(".md"));
    const metas: NoteMeta[] = [];

    for (const file of files) {
      const id = file.name.replace(/\.md$/i, "");
      try {
        const content = await workspace.readFile(pathForId(id));
        metas.push({
          id,
          title: titleFromContent(content, id),
          updatedAt: Date.now(),
        });
      } catch {
        metas.push({ id, title: id, updatedAt: 0 });
      }
    }

    // Prefer local updatedAt ordering when available.
    const local = this.readLocal();
    const localMap = new Map(local.map((n) => [n.id, n.updatedAt]));
    metas.sort(
      (a, b) => (localMap.get(b.id) ?? b.updatedAt) - (localMap.get(a.id) ?? a.updatedAt),
    );
    this.notes = metas;

    if (!metas.length) {
      // Seed a welcome note in the workspace.
      await this.create("Welcome", "Welcome to Notes.\n\nWrite anything — notes auto-save.");
    }
  }

  async open(id: string) {
    if (this.dirty) {
      await this.flush();
    }
    this.activeId = id;

    if (workspace.status === "connected") {
      try {
        this.content = await workspace.readFile(pathForId(id));
      } catch {
        this.content = "";
      }
    } else {
      const note = this.readLocal().find((n) => n.id === id);
      this.content = note?.content ?? "";
    }
    this.dirty = false;
  }

  async create(title = "Untitled", body = "") {
    const id = `${slugify(title)}-${Date.now().toString(36)}`;
    const content = body || `# ${title}\n\n`;
    const meta: NoteMeta = {
      id,
      title: titleFromContent(content, title),
      updatedAt: Date.now(),
    };

    if (workspace.status === "connected") {
      try {
        await workspace.createDir(NOTES_DIR);
        await workspace.writeFile(pathForId(id), content);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create note");
        return;
      }
    } else {
      const all = this.readLocal();
      all.unshift({ ...meta, content });
      this.writeLocal(all);
    }

    this.notes = [meta, ...this.notes.filter((n) => n.id !== id)];
    this.activeId = id;
    this.content = content;
    this.dirty = false;
  }

  queueSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, 400);
  }

  async flush() {
    if (!this.activeId) return;
    const id = this.activeId;
    const content = this.content;
    const title = titleFromContent(content, "Untitled");
    const updatedAt = Date.now();

    this.saving = true;
    try {
      if (workspace.status === "connected") {
        await workspace.writeFile(pathForId(id), content);
      }

      const all = this.readLocal();
      const idx = all.findIndex((n) => n.id === id);
      const next: LocalNote = { id, title, content, updatedAt };
      if (idx >= 0) all[idx] = next;
      else all.unshift(next);
      this.writeLocal(all);

      this.notes = this.notes
        .map((n) => (n.id === id ? { id, title, updatedAt } : n))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      this.dirty = false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Notes save failed");
    } finally {
      this.saving = false;
    }
  }

  async remove(id: string) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;

    if (workspace.status === "connected") {
      try {
        await workspace.remove(pathForId(id));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
        return;
      }
    }

    const all = this.readLocal().filter((n) => n.id !== id);
    this.writeLocal(all);
    this.notes = this.notes.filter((n) => n.id !== id);

    if (this.activeId === id) {
      const next = this.notes[0];
      if (next) await this.open(next.id);
      else {
        this.activeId = null;
        this.content = "";
      }
    }
  }
}

export const notesStore = new NotesStore();
