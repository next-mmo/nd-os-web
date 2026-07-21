import { setMode } from "mode-watcher";
import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import type { Settings } from "./types";

export const defaultSettings: Settings = {
  theme: "dark",
  wallpaper: "aurora",
  accent: "#7c3aed",
  taskbarAlignment: "center",
  showSeconds: false,
};

class SettingsStore {
  current = $state<Settings>({ ...defaultSettings });
  hydrated = $state(false);

  private applyTheme(theme: Settings["theme"]) {
    setMode(theme);
    document.documentElement.dataset.theme = theme;
  }

  hydrate() {
    const stored = localStorage.getItem(STORAGE_KEYS.settings);
    if (stored) {
      try {
        this.current = { ...defaultSettings, ...JSON.parse(stored) };
      } catch {
        this.current = { ...defaultSettings };
      }
    }
    this.applyTheme(this.current.theme);
    this.hydrated = true;
  }

  persist() {
    if (!this.hydrated) return;
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.current));
    this.applyTheme(this.current.theme);
  }

  patch(partial: Partial<Settings>) {
    this.current = { ...this.current, ...partial };
    this.persist();
  }

  toggleTheme() {
    this.patch({ theme: this.current.theme === "dark" ? "light" : "dark" });
  }

  reset() {
    this.current = { ...defaultSettings };
    this.persist();
  }
}

export const settingsStore = new SettingsStore();
