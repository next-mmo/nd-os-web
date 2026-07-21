import { toast } from "@/shared/lib/toast.svelte";
import { appCatalog } from "./catalog";
import { settingsStore } from "./settings.svelte";
import type { AppId, Menu, WindowState } from "./types";
import { windowManager } from "./window-manager.svelte";

type MenubarActions = {
  openApp: (id: AppId) => void;
  openSpotlight: () => void;
  resetSettings: () => void;
};

export function buildMenubar(
  activeWindow: AppId | null,
  windows: WindowState[],
  actions: MenubarActions,
): Menu[] {
  const appName = activeWindow ? appCatalog[activeWindow].title : "Desktop";
  const win = activeWindow ? windows.find((w) => w.id === activeWindow) : null;
  const close = () => activeWindow && windowManager.close(activeWindow);
  const minimize = () => activeWindow && windowManager.minimize(activeWindow);
  const zoom = () => activeWindow && windowManager.toggleMaximize(activeWindow);
  const cycle = () => {
    if (!windows.length) return;
    const sorted = [...windows].sort((a, b) => a.z - b.z);
    const target = sorted.find((w) => !w.minimized) ?? sorted[0];
    if (target) windowManager.focus(target.id);
  };

  return [
    {
      id: "app",
      label: appName,
      items: [
        { type: "item", label: `About ${appName}`, action: () => actions.openApp("about") },
        { type: "separator" },
        { type: "item", label: "Settings…", action: () => actions.openApp("settings") },
        { type: "separator" },
        {
          type: "item",
          label: activeWindow ? `Hide ${appName}` : "Hide Desktop",
          action: minimize,
          disabled: !activeWindow,
        },
        { type: "separator" },
        { type: "item", label: "Reset settings", action: actions.resetSettings },
      ],
    },
    {
      id: "file",
      label: "File",
      items: [
        {
          type: "item",
          label: "New window",
          action: () => activeWindow && actions.openApp(activeWindow),
        },
        { type: "separator" },
        { type: "item", label: "Close window", action: close, disabled: !activeWindow },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { type: "item", label: "Undo", action: () => toast.show("Undo") },
        { type: "item", label: "Redo", action: () => toast.show("Redo") },
        { type: "separator" },
        { type: "item", label: "Cut", action: () => toast.show("Cut") },
        { type: "item", label: "Copy", action: () => toast.show("Copy") },
        { type: "item", label: "Paste", action: () => toast.show("Paste") },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        {
          type: "item",
          label: win?.maximized ? "Exit full screen" : "Enter full screen",
          action: zoom,
          disabled: !activeWindow,
        },
        { type: "separator" },
        { type: "item", label: "Toggle theme", action: () => settingsStore.toggleTheme() },
        { type: "item", label: "Open Spotlight", action: actions.openSpotlight },
      ],
    },
    {
      id: "window",
      label: "Window",
      items: [
        { type: "item", label: "Minimize", action: minimize, disabled: !activeWindow },
        { type: "item", label: "Zoom", action: zoom, disabled: !activeWindow },
        { type: "separator" },
        { type: "item", label: "Cycle windows", action: cycle },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [{ type: "item", label: "ND OS Web Help", action: () => actions.openApp("about") }],
    },
  ];
}
