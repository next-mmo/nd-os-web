// Reactive workspace store. Feature apps and the desktop shell consume this.
// Uses durable IndexedDB storage so a connected workspace survives reloads
// until the user explicitly disconnects / changes workspace.

import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { detectBackend } from "./detect";
import { fsaBackend } from "./fsa";
import { fallbackBackend } from "./fallback";
import type { Entry, WorkspaceImpl } from "./types";

export type WorkspaceStatus = "disconnected" | "connecting" | "connected";
export type WorkspaceBackend = "native" | "fallback";

const SEEDED_KEY = STORAGE_KEYS.workspaceSeeded;
const BOUND_KEY = STORAGE_KEYS.workspaceBound;

class WorkspaceStore {
  status = $state<WorkspaceStatus>("disconnected");
  backend = $state<WorkspaceBackend | null>(null);
  error = $state<string | null>(null);
  revision = $state(0);
  /** True when a prior workspace exists but is not active yet (loading / rare errors). */
  hasStoredHandle = $state(false);
  /** True while tryRestore is running on mount. */
  restoring = $state(false);

  private impl: WorkspaceImpl | null = null;
  private restoreGeneration = 0;

  get isNative(): boolean {
    return this.backend === "native";
  }

  private pickImpl(backend: WorkspaceBackend): WorkspaceImpl {
    return backend === "native" ? fsaBackend : fallbackBackend;
  }

  private rememberBound(backend: WorkspaceBackend) {
    localStorage.setItem(BOUND_KEY, backend);
  }

  private forgetBound() {
    localStorage.removeItem(BOUND_KEY);
  }

  private wasConnectedBefore(): boolean {
    const bound = localStorage.getItem(BOUND_KEY);
    // Treat any prior bind (including legacy "native") as "should auto-restore".
    return bound === "native" || bound === "fallback" || Boolean(localStorage.getItem(SEEDED_KEY));
  }

  /** Called once on app mount — silently restore if the user was connected before. */
  async tryRestore(): Promise<void> {
    const generation = ++this.restoreGeneration;
    this.restoring = true;
    this.error = null;

    try {
      const backend = detectBackend();
      const impl = this.pickImpl(backend);
      console.log("[workspace] tryRestore start, backend =", backend);

      let stored = false;
      try {
        stored = await impl.hasStoredRoot();
      } catch (err) {
        console.error("[workspace] hasStoredRoot threw:", err);
      }

      const shouldRestore = stored || this.wasConnectedBefore();
      this.hasStoredHandle = shouldRestore;
      console.log("[workspace] hasStoredRoot =", stored, "shouldRestore =", shouldRestore);

      if (!shouldRestore) {
        this.status = "disconnected";
        return;
      }

      this.status = "connecting";
      await impl.pickRoot();
      if (generation !== this.restoreGeneration) return;
      await this.activate(impl, backend);
    } catch (err) {
      console.error("[workspace] tryRestore failed:", err);
      if (generation !== this.restoreGeneration) return;
      this.status = "disconnected";
      this.hasStoredHandle = this.wasConnectedBefore();
    } finally {
      if (generation === this.restoreGeneration) {
        this.restoring = false;
      }
    }
  }

  private async activate(impl: WorkspaceImpl, backend: WorkspaceBackend) {
    await this.seedIfFirstRun(impl);
    this.impl = impl;
    this.backend = backend;
    this.status = "connected";
    this.hasStoredHandle = false;
    this.rememberBound(backend);
    this.bump();
    console.log("[workspace] activated", backend);
  }

  /** Connect the workspace. Returns true on success. */
  async connect(): Promise<boolean> {
    if (this.status === "connecting" || this.status === "connected") {
      return this.status === "connected";
    }
    this.error = null;
    this.status = "connecting";
    const backend = detectBackend();
    const impl = this.pickImpl(backend);
    console.log("[workspace] connect start, backend =", backend);

    try {
      await impl.pickRoot();
      await this.activate(impl, backend);
      return true;
    } catch (err) {
      console.error("[workspace] connect threw:", err);
      this.error = err instanceof Error ? err.message : String(err);
      this.status = "disconnected";
      this.hasStoredHandle = this.wasConnectedBefore();
      return false;
    }
  }

  /** Explicitly leave the workspace — clears stored files and bind state. */
  async disconnect(): Promise<void> {
    if (this.impl) {
      await this.impl.clearRoot();
    }
    this.impl = null;
    this.backend = null;
    this.status = "disconnected";
    this.hasStoredHandle = false;
    this.forgetBound();
    localStorage.removeItem(SEEDED_KEY);
    this.bump();
  }

  private async seedIfFirstRun(impl: WorkspaceImpl): Promise<void> {
    if (localStorage.getItem(SEEDED_KEY)) return;
    try {
      await impl.createDir("/Documents");
      await impl.createDir("/Pictures");
      await impl.createDir("/Downloads");
      await impl.writeFile(
        "/Welcome.txt",
        "Welcome to your ND OS workspace.\n\n" +
          "Files you create here are stored in this browser and stay available " +
          "after reload until you disconnect the workspace.\n\n" +
          "Try opening the Files app, or use the Terminal with `ls`, `cat`, `mkdir`.",
      );

      await impl.createDir("/Notes");
      const legacy = localStorage.getItem(STORAGE_KEYS.notes);
      if (legacy && !(await this.existsSafe(impl, "/Notes/Welcome.md"))) {
        await impl.writeFile("/Notes/Welcome.md", legacy);
      }

      localStorage.setItem(SEEDED_KEY, "1");
    } catch {
      // Seeding is best-effort; don't block connect on it.
    }
  }

  private async existsSafe(impl: WorkspaceImpl, path: string): Promise<boolean> {
    try {
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      const entries = await impl.list(parent);
      return entries.some((e) => e.name === path.slice(path.lastIndexOf("/") + 1));
    } catch {
      return false;
    }
  }

  private require(): WorkspaceImpl {
    if (!this.impl) throw new Error("Workspace not connected");
    return this.impl;
  }

  private bump() {
    this.revision++;
  }

  async list(path: string): Promise<Entry[]> {
    return this.require().list(path);
  }
  async readFile(path: string): Promise<string> {
    return this.require().readFile(path);
  }
  async writeFile(path: string, content: string): Promise<void> {
    await this.require().writeFile(path, content);
    this.bump();
  }
  async createFile(path: string): Promise<void> {
    await this.require().createFile(path);
    this.bump();
  }
  async createDir(path: string): Promise<void> {
    await this.require().createDir(path);
    this.bump();
  }
  async remove(path: string): Promise<void> {
    await this.require().remove(path);
    this.bump();
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.require().rename(oldPath, newPath);
    this.bump();
  }
}

export const workspace = new WorkspaceStore();
