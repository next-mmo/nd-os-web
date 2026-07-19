// Reactive workspace store. The single source of truth that App.svelte and all
// apps consume. Picks the best backend for the current browser, manages connect
// and re-permission flows, and exposes a backend-agnostic API over POSIX paths.

import { detectBackend } from "./detect";
import { fsaBackend } from "./fsa";
import { fallbackBackend } from "./fallback";
import type { Entry, WorkspaceImpl } from "./types";

export type WorkspaceStatus = "disconnected" | "connecting" | "connected";
export type WorkspaceBackend = "native" | "fallback";

const SEEDED_KEY = "nd-os-web:workspace-seeded";

class WorkspaceStore {
  // Reactive (Svelte 5 runes) — components read these directly.
  status = $state<WorkspaceStatus>("disconnected");
  backend = $state<WorkspaceBackend | null>(null);
  error = $state<string | null>(null);
  /** Bumped on every mutation so consumers can re-list without explicit wires. */
  revision = $state(0);
  /**
   * True when a root handle is persisted but not yet active — i.e. the user
   * picked a folder before, then reloaded, and now needs a one-click re-grant.
   * Distinguishes "Connect for the first time" from "Reconnect".
   */
  hasStoredHandle = $state(false);
  /** True while tryRestore is running on mount — lets UI show a brief spinner. */
  restoring = $state(false);

  private impl: WorkspaceImpl | null = null;

  get isNative(): boolean {
    return this.backend === "native";
  }

  private pickImpl(backend: WorkspaceBackend): WorkspaceImpl {
    return backend === "native" ? fsaBackend : fallbackBackend;
  }

  /** Called once on app mount: try to silently reconnect a previously-persisted handle. */
  async tryRestore(): Promise<void> {
    this.restoring = true;
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
      console.log("[workspace] hasStoredRoot =", stored);
      this.hasStoredHandle = stored;
      if (!stored) return;
      this.status = "connecting";
      if (backend === "native") {
        let granted = false;
        try {
          granted = await impl.hasPermissionGranted();
        } catch (err) {
          console.error("[workspace] hasPermissionGranted threw:", err);
        }
        console.log("[workspace] hasPermissionGranted =", granted);
        if (granted) {
          await this.seedIfFirstRun(impl);
          this.impl = impl;
          this.backend = backend;
          this.status = "connected";
          this.hasStoredHandle = false;
          this.bump();
        } else {
          this.status = "disconnected";
        }
        return;
      }
      try {
        await impl.pickRoot();
        await this.seedIfFirstRun(impl);
        this.impl = impl;
        this.backend = backend;
        this.status = "connected";
        this.hasStoredHandle = false;
        this.bump();
      } catch (err) {
        console.error("[workspace] fallback pickRoot threw:", err);
        this.status = "disconnected";
      }
    } catch (err) {
      console.error("[workspace] tryRestore failed:", err);
      this.status = "disconnected";
    } finally {
      this.restoring = false;
    }
  }

  /** Connect (or reconnect) the workspace. Returns true on success. */
  async connect(): Promise<boolean> {
    if (this.status === "connecting") return false;
    this.error = null;
    this.status = "connecting";
    const backend = detectBackend();
    const impl = this.pickImpl(backend);
    console.log("[workspace] connect start, backend =", backend);
    try {
      if (backend === "native") {
        const hasStored = await impl.hasStoredRoot();
        console.log("[workspace] connect: hasStoredRoot =", hasStored);
        if (!hasStored) {
          console.log("[workspace] connect: calling pickRoot…");
          const picked = await impl.pickRoot();
          console.log("[workspace] connect: pickRoot returned", picked);
          if (!picked) {
            console.log("[workspace] connect: user cancelled picker");
            this.status = "disconnected";
            return false;
          }
        } else {
          console.log("[workspace] connect: requesting permission…");
          const granted = await impl.requestPermissionIfNeeded();
          console.log("[workspace] connect: requestPermissionIfNeeded =", granted);
          if (!granted) {
            console.log("[workspace] connect: denied, re-picking folder…");
            const picked = await impl.pickRoot();
            if (!picked) {
              this.status = "disconnected";
              return false;
            }
          }
        }
      } else {
        await impl.pickRoot();
      }
      console.log("[workspace] connect: seeding if first run…");
      await this.seedIfFirstRun(impl);
      console.log("[workspace] connect: marking connected");
      this.impl = impl;
      this.backend = backend;
      this.status = "connected";
      this.hasStoredHandle = false;
      this.bump();
      return true;
    } catch (err) {
      console.error("[workspace] connect threw:", err);
      this.error = err instanceof Error ? err.message : String(err);
      this.status = "disconnected";
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.impl) {
      await this.impl.clearRoot();
    }
    this.impl = null;
    this.backend = null;
    this.status = "disconnected";
    this.hasStoredHandle = false;
    this.bump();
  }

  private async seedIfFirstRun(impl: WorkspaceImpl): Promise<void> {
    if (localStorage.getItem(SEEDED_KEY)) return;
    try {
      // Seed the standard folders + a welcome file.
      await impl.createDir("/Documents");
      await impl.createDir("/Pictures");
      await impl.createDir("/Downloads");
      await impl.writeFile(
        "/Welcome.txt",
        "Welcome to your ND OS workspace.\n\n" +
          "Files you create here are saved as real files on Chromium browsers, " +
          "or in persistent browser storage on Firefox/Safari.\n\n" +
          "Try opening the Files app, or use the Terminal with `ls`, `cat`, `mkdir`.",
      );

      // Migrate the legacy single-note localStorage value, if present.
      const legacy = localStorage.getItem("nd-os-web:notes");
      if (legacy && !(await this.existsSafe(impl, "/Notes.md"))) {
        await impl.writeFile("/Notes.md", legacy);
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

  // --- public filesystem API (delegate to the active backend) ---
  async list(path: string): Promise<Entry[]> {
    const out = await this.require().list(path);
    return out;
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

// Singleton import — same instance across all importers.
export const workspace = new WorkspaceStore();
