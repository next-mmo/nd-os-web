import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { appCatalog, defaultWindowSize } from "./catalog";
import type { AppId, DragEdge, Rect, SnapSide, WindowState } from "./types";

/** Usable desktop area, mirroring CSS insets on .desktop-space / .windows-layer. */
const DESKTOP_TOP = 38;
const DESKTOP_BOTTOM = 74;
const SNAP_MARGIN = 8;
const MIN_W = 320;
const MIN_H = 240;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_JITTER = 5;

type DragState = {
  id: AppId;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
  edges: DragEdge[];
};

class WindowManager {
  windows = $state<WindowState[]>([]);
  private zCounter = 10;
  private drag: DragState | null = null;
  private lastTitleClick: { id: AppId; time: number; x: number; y: number } | null = null;
  private hydrated = false;

  get visibleWindows(): WindowState[] {
    return this.windows.filter((w) => !w.minimized);
  }

  get activeWindow(): AppId | null {
    if (!this.windows.length) return null;
    return (
      [...this.windows].sort((a, b) => b.z - a.z).find((w) => !w.minimized)?.id ?? null
    );
  }

  hydrate() {
    const stored = localStorage.getItem(STORAGE_KEYS.windows);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as WindowState[];
        if (Array.isArray(parsed) && parsed.length) {
          this.windows = parsed.filter(
            (w) =>
              w &&
              typeof w.id === "string" &&
              typeof w.x === "number" &&
              typeof w.y === "number" &&
              typeof w.width === "number" &&
              typeof w.height === "number" &&
              appCatalog[w.id as AppId],
          );
          this.zCounter = Math.max(10, ...this.windows.map((w) => w.z ?? 0)) + 1;
          this.clampToViewport();
        }
      } catch {
        this.windows = [];
      }
    }
    this.hydrated = true;
  }

  persist() {
    if (!this.hydrated) return;
    localStorage.setItem(STORAGE_KEYS.windows, JSON.stringify(this.windows));
  }

  open(id: AppId) {
    const existing = this.windows.find((w) => w.id === id);
    this.zCounter += 1;

    if (existing) {
      this.windows = this.windows.map((w) =>
        w.id === id ? { ...w, minimized: false, z: this.zCounter } : w,
      );
      this.persist();
      return;
    }

    const catalogEntry = appCatalog[id];
    const size = defaultWindowSize(id);
    const offset = this.windows.length * 30;

    this.windows = [
      ...this.windows,
      {
        id,
        title: catalogEntry.title,
        icon: catalogEntry.icon,
        x: Math.min(120 + offset, Math.max(18, window.innerWidth - 700)),
        y: Math.min(86 + offset, Math.max(50, window.innerHeight - 520)),
        width: size.width,
        height: size.height,
        minimized: false,
        maximized: true,
        snap: null,
        restoreRect: null,
        z: this.zCounter,
      },
    ];
    this.persist();
  }

  focus(id: AppId) {
    this.zCounter += 1;
    this.windows = this.windows.map((w) => (w.id === id ? { ...w, z: this.zCounter } : w));
    this.persist();
  }

  close(id: AppId) {
    this.windows = this.windows.filter((w) => w.id !== id);
    this.persist();
  }

  minimize(id: AppId) {
    this.windows = this.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
    this.persist();
  }

  toggleMaximize(id: AppId) {
    this.focus(id);
    this.windows = this.windows.map((w) =>
      w.id === id
        ? {
            ...w,
            maximized: !w.maximized,
            minimized: false,
            snap: !w.maximized ? null : w.snap,
            restoreRect: !w.maximized ? null : w.restoreRect,
          }
        : w,
    );
    this.persist();
  }

  toggleTaskbar(id: AppId) {
    const target = this.windows.find((w) => w.id === id);
    if (!target) {
      this.open(id);
      return;
    }

    if (!target.minimized && this.activeWindow === id) {
      this.minimize(id);
      return;
    }

    this.focus(id);
    this.windows = this.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w));
    this.persist();
  }

  private desktopRect(): Rect {
    const layerW = window.innerWidth;
    const layerH = Math.max(0, window.innerHeight - DESKTOP_TOP - DESKTOP_BOTTOM);
    return {
      x: SNAP_MARGIN,
      y: SNAP_MARGIN,
      width: Math.max(0, layerW - SNAP_MARGIN * 2),
      height: Math.max(0, layerH - SNAP_MARGIN * 2),
    };
  }

  private snapRect(side: SnapSide): Rect {
    const area = this.desktopRect();
    return {
      x: side === "left" ? area.x : area.x + area.width / 2 + SNAP_MARGIN / 2,
      y: area.y,
      width: area.width / 2 - SNAP_MARGIN / 2,
      height: area.height,
    };
  }

  snap(id: AppId, side: SnapSide) {
    this.focus(id);
    this.windows = this.windows.map((w) => {
      if (w.id !== id) return w;

      if (w.snap === side && w.restoreRect) {
        return {
          ...w,
          ...w.restoreRect,
          snap: null,
          restoreRect: null,
          maximized: false,
          minimized: false,
        };
      }

      const restore: Rect =
        w.restoreRect ?? { x: w.x, y: w.y, width: w.width, height: w.height };
      const target = this.snapRect(side);
      return {
        ...w,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        snap: side,
        restoreRect: restore,
        maximized: false,
        minimized: false,
      };
    });
    this.persist();
  }

  clampToViewport() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.windows = this.windows.map((w) => {
      if (w.maximized) return w;
      const width = Math.min(w.width, vw - 24);
      const height = Math.min(w.height, vh - 120);
      const x = Math.max(8, Math.min(w.x, vw - width - 8));
      const y = Math.max(38, Math.min(w.y, vh - height - 8));
      return { ...w, x, y, width, height };
    });
    this.persist();
  }

  resnapAll() {
    this.windows = this.windows.map((w) => {
      if (!w.snap) return w;
      const target = this.snapRect(w.snap);
      return { ...w, x: target.x, y: target.y, width: target.width, height: target.height };
    });
    this.clampToViewport();
  }

  startDrag(event: MouseEvent, windowState: WindowState) {
    if (event.target instanceof Element && event.target.closest("button")) return;

    this.focus(windowState.id);

    const now = event.timeStamp;
    if (
      this.lastTitleClick &&
      this.lastTitleClick.id === windowState.id &&
      now - this.lastTitleClick.time < DOUBLE_CLICK_MS &&
      Math.abs(event.clientX - this.lastTitleClick.x) < DOUBLE_CLICK_JITTER &&
      Math.abs(event.clientY - this.lastTitleClick.y) < DOUBLE_CLICK_JITTER
    ) {
      this.lastTitleClick = null;
      this.toggleMaximize(windowState.id);
      return;
    }
    this.lastTitleClick = {
      id: windowState.id,
      time: now,
      x: event.clientX,
      y: event.clientY,
    };

    if (windowState.maximized) return;

    if (windowState.snap && windowState.restoreRect) {
      const restored = windowState.restoreRect;
      this.windows = this.windows.map((w) =>
        w.id === windowState.id ? { ...w, ...restored, snap: null, restoreRect: null } : w,
      );
    }

    const current = this.windows.find((w) => w.id === windowState.id) ?? windowState;
    this.drag = {
      id: windowState.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      originW: current.width,
      originH: current.height,
      edges: [],
    };
  }

  startResize(event: MouseEvent, windowState: WindowState, edges: DragEdge[]) {
    if (windowState.maximized) return;
    event.stopPropagation();
    event.preventDefault();
    this.focus(windowState.id);

    if (windowState.snap && windowState.restoreRect) {
      const restored = windowState.restoreRect;
      this.windows = this.windows.map((w) =>
        w.id === windowState.id ? { ...w, ...restored, snap: null, restoreRect: null } : w,
      );
    }

    const current = this.windows.find((w) => w.id === windowState.id) ?? windowState;
    this.drag = {
      id: windowState.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      originW: current.width,
      originH: current.height,
      edges,
    };
  }

  handlePointerMove(event: MouseEvent) {
    if (!this.drag) return;

    const dx = event.clientX - this.drag.startX;
    const dy = event.clientY - this.drag.startY;

    if (this.drag.edges.length === 0) {
      const nextX = Math.max(0, Math.min(window.innerWidth - 280, this.drag.originX + dx));
      const nextY = Math.max(38, Math.min(window.innerHeight - 140, this.drag.originY + dy));
      this.windows = this.windows.map((w) =>
        w.id === this.drag!.id ? { ...w, x: nextX, y: nextY } : w,
      );
      return;
    }

    let { originX: x, originY: y, originW: w, originH: h } = this.drag;
    if (this.drag.edges.includes("right")) w = Math.max(MIN_W, this.drag.originW + dx);
    if (this.drag.edges.includes("bottom")) h = Math.max(MIN_H, this.drag.originH + dy);
    if (this.drag.edges.includes("left")) {
      const newW = Math.max(MIN_W, this.drag.originW - dx);
      x = this.drag.originX + (this.drag.originW - newW);
      w = newW;
    }
    if (this.drag.edges.includes("top")) {
      const newH = Math.max(MIN_H, this.drag.originH - dy);
      y = Math.max(38, this.drag.originY + (this.drag.originH - newH));
      h = newH;
    }

    this.windows = this.windows.map((windowState) =>
      windowState.id === this.drag?.id
        ? { ...windowState, x, y, width: w, height: h }
        : windowState,
    );
  }

  endDrag() {
    if (this.drag) {
      this.drag = null;
      this.persist();
    }
  }
}

export const windowManager = new WindowManager();
