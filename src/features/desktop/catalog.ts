import type { AppId, AppMeta } from "./types";

/** Installed app registry — add new apps here, then mount a component in `registry.ts`. */
export const appCatalog: Record<AppId, AppMeta> = {
  files: { title: "Files", icon: "📁", description: "Browse starter folders" },
  notes: { title: "Notes", icon: "📝", description: "Saved notes list with auto-save" },
  settings: { title: "Settings", icon: "⚙️", description: "Personalize ND OS" },
  about: { title: "About", icon: "◈", description: "About this web starter" },
  calculator: { title: "Calculator", icon: "🧮", description: "Quick arithmetic" },
  terminal: { title: "Terminal", icon: "⌥", description: "Mock shell session" },
  calendar: { title: "Calendar", icon: "📅", description: "Month view calendar" },
  editor: { title: "Text Editor", icon: "📄", description: "Edit workspace files" },
  "tts-studio": {
    title: "AI TTS Studio",
    icon: "🎙",
    description: "Local-first text-to-speech with VoxCPM2",
  },
  poker: {
    title: "Poker",
    icon: "♠",
    description: "Texas Hold'em — bots or friends in-browser",
  },
};

export const APP_IDS = Object.keys(appCatalog) as AppId[];

/** Default window size for each app when first opened. */
export function defaultWindowSize(id: AppId): { width: number; height: number } {
  switch (id) {
    case "settings":
      return { width: 760, height: 500 };
    case "calculator":
      return { width: 320, height: 480 };
    case "terminal":
      return { width: 680, height: 420 };
    case "editor":
      return { width: 720, height: 520 };
    case "tts-studio":
      return { width: 1100, height: 720 };
    case "poker":
      return { width: 1000, height: 680 };
    default:
      return { width: 680, height: 450 };
  }
}
