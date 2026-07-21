export type AppId =
  | "files"
  | "notes"
  | "settings"
  | "about"
  | "calculator"
  | "terminal"
  | "calendar"
  | "editor"
  | "tts-studio";

export type Theme = "dark" | "light";
export type Wallpaper = "aurora" | "midnight" | "sunrise" | "forest";
export type TaskbarAlignment = "center" | "left";
export type SnapSide = "left" | "right";
export type DragEdge = "left" | "right" | "top" | "bottom";

export type Rect = { x: number; y: number; width: number; height: number };

export type WindowState = {
  id: AppId;
  title: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  snap: SnapSide | null;
  restoreRect: Rect | null;
  z: number;
};

export type Settings = {
  theme: Theme;
  wallpaper: Wallpaper;
  accent: string;
  taskbarAlignment: TaskbarAlignment;
  showSeconds: boolean;
};

export type AppMeta = {
  title: string;
  icon: string;
  description: string;
};

export type MenuItem =
  | { type: "item"; label: string; action: () => unknown; disabled?: boolean }
  | { type: "separator" };

export type Menu = { id: string; label: string; items: MenuItem[] };
