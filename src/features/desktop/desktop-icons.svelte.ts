import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { APP_IDS } from "./catalog";
import type { AppId } from "./types";

export type IconPos = { x: number; y: number };

const ICON_W = 96;
const ICON_H = 92;
const GRID_X = 104;
const GRID_Y = 100;
const PAD = 14;
const CELL_EPS = 2;

function defaultLayout(): Record<AppId, IconPos> {
  const layout = {} as Record<AppId, IconPos>;
  APP_IDS.forEach((id, i) => {
    layout[id] = { x: PAD, y: PAD + i * GRID_Y };
  });
  return layout;
}

function sameCell(a: IconPos, b: IconPos): boolean {
  return Math.abs(a.x - b.x) < CELL_EPS && Math.abs(a.y - b.y) < CELL_EPS;
}

function clampToBounds(pos: IconPos, bounds: { width: number; height: number }): IconPos {
  const maxX = Math.max(PAD, bounds.width - ICON_W - PAD);
  const maxY = Math.max(PAD, bounds.height - ICON_H - PAD);
  return {
    x: Math.min(maxX, Math.max(PAD, pos.x)),
    y: Math.min(maxY, Math.max(PAD, pos.y)),
  };
}

function snapRaw(x: number, y: number, bounds: { width: number; height: number }): IconPos {
  const sx = Math.round((x - PAD) / GRID_X) * GRID_X + PAD;
  const sy = Math.round((y - PAD) / GRID_Y) * GRID_Y + PAD;
  return clampToBounds({ x: sx, y: sy }, bounds);
}

function loadLayout(): Record<AppId, IconPos> {
  const base = defaultLayout();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.desktopIcons);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<AppId, IconPos>>;
    for (const id of APP_IDS) {
      const pos = parsed[id];
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        base[id] = { x: pos.x, y: pos.y };
      }
    }
  } catch {
    // keep defaults
  }
  return base;
}

class DesktopIconsStore {
  positions = $state<Record<AppId, IconPos>>(loadLayout());

  persist() {
    localStorage.setItem(STORAGE_KEYS.desktopIcons, JSON.stringify(this.positions));
  }

  private occupiedBy(exceptId: AppId): IconPos[] {
    return APP_IDS.filter((id) => id !== exceptId).map((id) => this.positions[id]);
  }

  private isFree(pos: IconPos, exceptId: AppId): boolean {
    return !this.occupiedBy(exceptId).some((other) => sameCell(other, pos));
  }

  /** Find nearest free grid cell to the preferred snap point (scan outward). */
  findFreeCell(
    preferred: IconPos,
    exceptId: AppId,
    bounds: { width: number; height: number },
  ): IconPos {
    const start = snapRaw(preferred.x, preferred.y, bounds);
    if (this.isFree(start, exceptId)) return start;

    const maxCol = Math.max(0, Math.floor((bounds.width - PAD - ICON_W) / GRID_X));
    const maxRow = Math.max(0, Math.floor((bounds.height - PAD - ICON_H) / GRID_Y));
    const startCol = Math.round((start.x - PAD) / GRID_X);
    const startRow = Math.round((start.y - PAD) / GRID_Y);

    for (let radius = 1; radius <= Math.max(maxCol, maxRow) + 2; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const col = startCol + dx;
          const row = startRow + dy;
          if (col < 0 || row < 0 || col > maxCol || row > maxRow) continue;
          const candidate = clampToBounds(
            { x: PAD + col * GRID_X, y: PAD + row * GRID_Y },
            bounds,
          );
          if (this.isFree(candidate, exceptId)) return candidate;
        }
      }
    }

    // Fallback: stack below the last icon in the first column.
    return clampToBounds(
      { x: PAD, y: PAD + APP_IDS.length * GRID_Y },
      bounds,
    );
  }

  /** Resolve any loaded overlaps (e.g. from older saves). */
  resolveOverlaps(bounds: { width: number; height: number }) {
    const next = { ...this.positions };

    for (const id of APP_IDS) {
      // Make findFreeCell see icons already resolved in this pass.
      this.positions = next;
      const preferred = clampToBounds(next[id], bounds);
      next[id] = this.findFreeCell(preferred, id, bounds);
    }

    this.positions = next;
    this.persist();
  }

  move(id: AppId, x: number, y: number, bounds: { width: number; height: number }) {
    const maxX = Math.max(PAD, bounds.width - ICON_W - PAD);
    const maxY = Math.max(PAD, bounds.height - ICON_H - PAD);
    this.positions = {
      ...this.positions,
      [id]: {
        x: Math.min(maxX, Math.max(0, x)),
        y: Math.min(maxY, Math.max(0, y)),
      },
    };
  }

  drop(id: AppId, x: number, y: number, bounds: { width: number; height: number }) {
    const preferred = snapRaw(x, y, bounds);
    const free = this.findFreeCell(preferred, id, bounds);
    this.positions = {
      ...this.positions,
      [id]: free,
    };
    this.persist();
  }

  reset() {
    this.positions = defaultLayout();
    this.persist();
  }
}

export const desktopIcons = new DesktopIconsStore();
export const DESKTOP_ICON = { w: ICON_W, h: ICON_H, gridX: GRID_X, gridY: GRID_Y };
