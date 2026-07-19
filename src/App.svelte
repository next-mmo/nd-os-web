<script lang="ts">
  import { onMount } from "svelte";
  import { workspace, detectBackend } from "./lib/workspace";

  type AppId = "files" | "notes" | "settings" | "about" | "calculator" | "terminal" | "calendar" | "editor";
  type Theme = "dark" | "light";
  type Wallpaper = "aurora" | "midnight" | "sunrise" | "forest";
  type TaskbarAlignment = "center" | "left";

  type SnapSide = "left" | "right";
  type Rect = { x: number; y: number; width: number; height: number };
  type WindowState = {
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

  // Usable desktop area, mirroring the CSS insets on .desktop-space / .windows-layer.
  const DESKTOP_TOP = 38;
  const DESKTOP_BOTTOM = 74;
  const SNAP_MARGIN = 8;

  type Settings = {
    theme: Theme;
    wallpaper: Wallpaper;
    accent: string;
    taskbarAlignment: TaskbarAlignment;
    showSeconds: boolean;
  };

  const appCatalog: Record<AppId, { title: string; icon: string; description: string }> = {
    files: { title: "Files", icon: "📁", description: "Browse starter folders" },
    notes: { title: "Notes", icon: "📝", description: "Local browser notes" },
    settings: { title: "Settings", icon: "⚙️", description: "Personalize ND OS" },
    about: { title: "About", icon: "◈", description: "About this web starter" },
    calculator: { title: "Calculator", icon: "🧮", description: "Quick arithmetic" },
    terminal: { title: "Terminal", icon: "⌥", description: "Mock shell session" },
    calendar: { title: "Calendar", icon: "📅", description: "Month view calendar" },
    editor: { title: "Text Editor", icon: "📝", description: "Edit workspace files" },
  };

  const wallpapers: Record<Wallpaper, string> = {
    aurora:
      "radial-gradient(circle at 15% 18%, rgba(45,212,191,.42), transparent 26%), radial-gradient(circle at 80% 15%, rgba(129,140,248,.38), transparent 30%), linear-gradient(145deg, #0f172a 5%, #172554 48%, #0f766e 120%)",
    midnight:
      "radial-gradient(circle at 70% 18%, rgba(99,102,241,.35), transparent 26%), radial-gradient(circle at 20% 82%, rgba(14,165,233,.25), transparent 28%), linear-gradient(145deg, #020617, #111827 52%, #172554)",
    sunrise:
      "radial-gradient(circle at 75% 20%, rgba(253,186,116,.65), transparent 25%), radial-gradient(circle at 22% 70%, rgba(244,114,182,.32), transparent 30%), linear-gradient(145deg, #312e81, #9f1239 55%, #f97316 120%)",
    forest:
      "radial-gradient(circle at 20% 20%, rgba(134,239,172,.3), transparent 25%), radial-gradient(circle at 75% 75%, rgba(45,212,191,.24), transparent 28%), linear-gradient(145deg, #052e16, #14532d 52%, #164e63)",
  };

  const defaultSettings: Settings = {
    theme: "dark",
    wallpaper: "aurora",
    accent: "#7c3aed",
    taskbarAlignment: "center",
    showSeconds: false,
  };

  let settings: Settings = { ...defaultSettings };
  let windows: WindowState[] = [];
  let startOpen = false;
  let selectedIcon: AppId | null = null;
  let contextMenu: { x: number; y: number } | null = null;
  let spotlightOpen = false;
  let spotlightQuery = "";
  let spotlightIndex = 0;
  let openMenu: string | null = null;

  // Menubar structure. The app-name entry uses the active app's title;
  // actions adapt to whether a window is open.
  type MenuItem =
    | { type: "item"; label: string; action: () => unknown; disabled?: boolean }
    | { type: "separator" };
  type Menu = { id: string; label: string; items: MenuItem[] };

  function runMenuAction(action: (() => unknown) | undefined) {
    if (action) action();
    openMenu = null;
  }

  $: menubar = (() => {
    const appName = activeWindow ? appCatalog[activeWindow].title : "Desktop";
    const win = activeWindow ? windows.find((w) => w.id === activeWindow) : null;
    const close = () => activeWindow && closeWindow(activeWindow);
    const minimize = () => activeWindow && minimizeWindow(activeWindow);
    const zoom = () => activeWindow && toggleMaximize(activeWindow);
    const cycle = () => {
      if (!windows.length) return;
      const sorted = [...windows].sort((a, b) => a.z - b.z);
      const target = sorted.find((w) => !w.minimized) ?? sorted[0];
      if (target) focusWindow(target.id);
    };
    return [
      {
        id: "app",
        label: appName,
        items: [
          { type: "item", label: `About ${appName}`, action: () => openApp("about") },
          { type: "separator" },
          { type: "item", label: "Settings…", action: () => openApp("settings") },
          { type: "separator" },
          { type: "item", label: activeWindow ? `Hide ${appName}` : "Hide Desktop", action: minimize, disabled: !activeWindow },
          { type: "separator" },
          { type: "item", label: "Reset settings", action: resetSettings },
        ],
      },
      {
        id: "file",
        label: "File",
        items: [
          { type: "item", label: "New window", action: () => activeWindow && openApp(activeWindow) },
          { type: "separator" },
          { type: "item", label: "Close window", action: close, disabled: !activeWindow },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        items: [
          { type: "item", label: "Undo", action: () => showToast("Undo") },
          { type: "item", label: "Redo", action: () => showToast("Redo") },
          { type: "separator" },
          { type: "item", label: "Cut", action: () => showToast("Cut") },
          { type: "item", label: "Copy", action: () => showToast("Copy") },
          { type: "item", label: "Paste", action: () => showToast("Paste") },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          { type: "item", label: win?.maximized ? "Exit full screen" : "Enter full screen", action: zoom, disabled: !activeWindow },
          { type: "separator" },
          { type: "item", label: "Toggle theme", action: toggleTheme },
          { type: "item", label: "Open Spotlight", action: openSpotlight },
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
        items: [{ type: "item", label: "ND OS Web Help", action: () => openApp("about") }],
      },
    ];
  })();
  let notes = "Welcome to ND OS Web.\n\nThis note is stored only in your browser.";
  // Calculator state
  let calcDisplay = "0";
  let calcPending: ((b: number) => number) | null = null;
  let calcFresh = true; // true means next digit starts a new number
  // Terminal state
  let termInput = "";
  let termLines: { kind: "in" | "out"; text: string }[] = [
    { kind: "out", text: "ND OS Web Terminal v0.1.0" },
    { kind: "out", text: "Type 'help' for available commands." },
  ];
  // Calendar state
  let calCursor = new Date();
  // Files app state
  let filesCwd = "/";
  let filesEntries: { name: string; kind: "file" | "directory"; size?: number }[] = [];
  let filesSelected: string | null = null;
  let filesLoading = false;
  let filesError: string | null = null;
  // Editor state
  let editorPath: string | null = null;
  let editorContent = "";
  let editorDirty = false;
  let editorRecent: string[] = JSON.parse(localStorage.getItem("nd-os-web:editor-recent") ?? "[]");
  let clock = new Date();
  let toast = "";
  let zCounter = 10;
  let hydrated = false;
  // drag handles both move and resize. `edge` is the set of sides being resized
  // (empty means a plain move). `originW`/`originH` anchor the start size.
  type DragEdge = "left" | "right" | "top" | "bottom";
  let drag:
    | {
        id: AppId;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        originW: number;
        originH: number;
        edges: DragEdge[];
      }
    | null = null;

  $: visibleWindows = windows.filter((windowState) => !windowState.minimized);
  $: activeWindow = windows.length
    ? [...windows].sort((a, b) => b.z - a.z).find((windowState) => !windowState.minimized)?.id ?? null
    : null;
  $: shellStyle = `--wallpaper:${wallpapers[settings.wallpaper]};--accent:${settings.accent}`;

  // Spotlight: fuzzy-match the query against the app catalog (title + description).
  $: spotlightResults = (() => {
    const q = spotlightQuery.trim().toLowerCase();
    const all = Object.entries(appCatalog).map(([id, app]) => ({ id: id as AppId, ...app }));
    if (!q) return all;
    return all
      .map((app) => {
        const haystack = `${app.title} ${app.description}`.toLowerCase();
        let score = 0;
        let qi = 0;
        for (let i = 0; i < haystack.length && qi < q.length; i++) {
          if (haystack[i] === q[qi]) {
            // Consecutive matches score higher.
            score += i === 0 || haystack[i - 1] === " " ? 3 : 1;
            qi++;
          }
        }
        return qi === q.length ? { app, score } : null;
      })
      .filter((r): r is { app: typeof all[number]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.app);
  })();

  function openSpotlight() {
    spotlightQuery = "";
    spotlightIndex = 0;
    spotlightOpen = true;
    startOpen = false;
    contextMenu = null;
  }

  function closeSpotlight() {
    spotlightOpen = false;
    spotlightQuery = "";
    spotlightIndex = 0;
  }

  function launchFromSpotlight(id: AppId) {
    closeSpotlight();
    openApp(id);
  }

  $: if (hydrated) {
    localStorage.setItem("nd-os-web:settings", JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }

  // Persist open windows so a reload restores the previous desktop.
  $: if (hydrated) {
    localStorage.setItem("nd-os-web:windows", JSON.stringify(windows));
  }

  // Keep window geometry inside the viewport after a resize (so windows that
  // were saved on a larger screen don't end up off-screen or oversized).
  function clampWindowsToViewport() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    windows = windows.map((w) => {
      if (w.maximized) return w;
      const width = Math.min(w.width, vw - 24);
      const height = Math.min(w.height, vh - 120);
      const x = Math.max(8, Math.min(w.x, vw - width - 8));
      const y = Math.max(38, Math.min(w.y, vh - height - 8));
      return { ...w, x, y, width, height };
    });
  }

  onMount(() => {
    const storedSettings = localStorage.getItem("nd-os-web:settings");
    const storedNotes = localStorage.getItem("nd-os-web:notes");
    const storedWindows = localStorage.getItem("nd-os-web:windows");

    if (storedSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(storedSettings) };
      } catch {
        settings = { ...defaultSettings };
      }
    }

    if (storedNotes !== null) notes = storedNotes;

    if (storedWindows) {
      try {
        const parsed = JSON.parse(storedWindows) as WindowState[];
        if (Array.isArray(parsed) && parsed.length) {
          // Drop anything that doesn't look like a valid window.
          windows = parsed.filter(
            (w) =>
              w &&
              typeof w.id === "string" &&
              typeof w.x === "number" &&
              typeof w.y === "number" &&
              typeof w.width === "number" &&
              typeof w.height === "number" &&
              appCatalog[w.id as AppId],
          );
          // Restore z-order so focus stacking keeps working.
          zCounter = Math.max(10, ...windows.map((w) => w.z ?? 0)) + 1;
          clampWindowsToViewport();
        }
      } catch {
        windows = [];
      }
    }

    document.documentElement.dataset.theme = settings.theme;
    hydrated = true;

    // Try to silently reconnect a previously-picked workspace (without
    // surprising the user with a permission popup on load).
    const restoreTimeout = window.setTimeout(() => {
      if (workspace.restoring || workspace.status === "connecting") {
        console.warn("[workspace] tryRestore timed out — falling back to disconnected");
        workspace.status = "disconnected";
        workspace.restoring = false;
      }
    }, 5000);
    workspace.tryRestore().catch(() => {
      if (workspace.status === "connecting") {
        workspace.status = "disconnected";
      }
      workspace.restoring = false;
    }).finally(() => clearTimeout(restoreTimeout));

    const timer = window.setInterval(() => {
      clock = new Date();
    }, 1000);

    const handleMove = (event: MouseEvent) => {
      if (!drag) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const MIN_W = 320;
      const MIN_H = 240;

      // Plain move — no edges being resized.
      if (drag.edges.length === 0) {
        const nextX = Math.max(0, Math.min(window.innerWidth - 280, drag.originX + dx));
        const nextY = Math.max(38, Math.min(window.innerHeight - 140, drag.originY + dy));
        windows = windows.map((w) =>
          w.id === drag!.id ? { ...w, x: nextX, y: nextY } : w,
        );
        return;
      }

      // Resize: clamp the new size to the min, and resolve the new x/y so the
      // opposite edge stays anchored (e.g. dragging the left edge moves x too).
      let { originX: x, originY: y, originW: w, originH: h } = drag;
      if (drag.edges.includes("right")) w = Math.max(MIN_W, drag.originW + dx);
      if (drag.edges.includes("bottom")) h = Math.max(MIN_H, drag.originH + dy);
      if (drag.edges.includes("left")) {
        const newW = Math.max(MIN_W, drag.originW - dx);
        x = drag.originX + (drag.originW - newW);
        w = newW;
      }
      if (drag.edges.includes("top")) {
        const newH = Math.max(MIN_H, drag.originH - dy);
        y = Math.max(38, drag.originY + (drag.originH - newH));
        h = newH;
      }

      windows = windows.map((windowState) =>
        windowState.id === drag?.id ? { ...windowState, x, y, width: w, height: h } : windowState,
      );
    };

    const handleUp = () => {
      drag = null;
    };

    const handleResize = () => {
      // Re-snap any snapped windows so they follow the new viewport size.
      windows = windows.map((w) => {
        if (!w.snap) return w;
        const target = snapRect(w.snap);
        return { ...w, x: target.x, y: target.y, width: target.width, height: target.height };
      });
      clampWindowsToViewport();
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("resize", handleResize);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("resize", handleResize);
    };
  });

  function formatTime(date: Date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: settings.showSeconds ? "2-digit" : undefined,
    }).format(date);
  }

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  }

  function openApp(id: AppId) {
    startOpen = false;
    contextMenu = null;
    selectedIcon = id;
    const existing = windows.find((windowState) => windowState.id === id);
    zCounter += 1;

    if (existing) {
      windows = windows.map((windowState) =>
        windowState.id === id ? { ...windowState, minimized: false, z: zCounter } : windowState,
      );
      return;
    }

    const catalogEntry = appCatalog[id];
    const offset = windows.length * 30;
    windows = [
      ...windows,
      {
        id,
        title: catalogEntry.title,
        icon: catalogEntry.icon,
        // Geometry kept as the restore target for when the user un-maximizes.
        x: Math.min(120 + offset, Math.max(18, window.innerWidth - 700)),
        y: Math.min(86 + offset, Math.max(50, window.innerHeight - 520)),
        width:
          id === "settings"
            ? 760
            : id === "calculator"
              ? 320
              : id === "terminal"
                ? 680
                : id === "editor"
                  ? 720
                  : 680,
        height:
          id === "settings"
            ? 500
            : id === "calculator"
              ? 480
              : id === "terminal"
                ? 420
                : id === "editor"
                  ? 520
                  : 450,
        minimized: false,
        maximized: true,
        snap: null,
        restoreRect: null,
        z: zCounter,
      },
    ];
  }

  function focusWindow(id: AppId) {
    zCounter += 1;
    windows = windows.map((windowState) =>
      windowState.id === id ? { ...windowState, z: zCounter } : windowState,
    );
  }

  function closeWindow(id: AppId) {
    windows = windows.filter((windowState) => windowState.id !== id);
  }

  function minimizeWindow(id: AppId) {
    windows = windows.map((windowState) =>
      windowState.id === id ? { ...windowState, minimized: true } : windowState,
    );
  }

  function toggleMaximize(id: AppId) {
    focusWindow(id);
    windows = windows.map((windowState) =>
      windowState.id === id
        ? {
            ...windowState,
            maximized: !windowState.maximized,
            minimized: false,
            // Clear snap state when toggling maximize so they don't fight each other.
            snap: !windowState.maximized ? null : windowState.snap,
            restoreRect: !windowState.maximized ? null : windowState.restoreRect,
          }
        : windowState,
    );
  }

  // Usable desktop area, in coordinates relative to .windows-layer (which is
  // already inset 38px from the topbar and 74px from the taskbar by CSS).
  // So x/y/width/height here are layer-local, not viewport-absolute.
  function desktopRect(): Rect {
    const layerW = window.innerWidth;
    const layerH = Math.max(0, window.innerHeight - DESKTOP_TOP - DESKTOP_BOTTOM);
    return {
      x: SNAP_MARGIN,
      y: SNAP_MARGIN,
      width: Math.max(0, layerW - SNAP_MARGIN * 2),
      height: Math.max(0, layerH - SNAP_MARGIN * 2),
    };
  }

  function snapRect(side: SnapSide): Rect {
    const area = desktopRect();
    return {
      x: side === "left" ? area.x : area.x + area.width / 2 + SNAP_MARGIN / 2,
      y: area.y,
      width: area.width / 2 - SNAP_MARGIN / 2,
      height: area.height,
    };
  }

  function snapWindow(id: AppId, side: SnapSide) {
    focusWindow(id);
    windows = windows.map((windowState) => {
      if (windowState.id !== id) return windowState;

      // Already snapped to this side → restore the pre-snap rectangle.
      if (windowState.snap === side && windowState.restoreRect) {
        return {
          ...windowState,
          ...windowState.restoreRect,
          snap: null,
          restoreRect: null,
          maximized: false,
          minimized: false,
        };
      }

      // Capture the current geometry once so a second press can restore it.
      const restore: Rect =
        windowState.restoreRect ?? {
          x: windowState.x,
          y: windowState.y,
          width: windowState.width,
          height: windowState.height,
        };

      const target = snapRect(side);
      return {
        ...windowState,
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
  }

  function toggleTaskbarApp(id: AppId) {
    const target = windows.find((windowState) => windowState.id === id);
    if (!target) {
      openApp(id);
      return;
    }

    if (!target.minimized && activeWindow === id) {
      minimizeWindow(id);
      return;
    }

    focusWindow(id);
    windows = windows.map((windowState) =>
      windowState.id === id ? { ...windowState, minimized: false } : windowState,
    );
  }

  // Track titlebar clicks so a double-click toggles maximize, matching Windows.
  let lastTitleClick: { id: AppId; time: number; x: number; y: number } | null = null;
  const DOUBLE_CLICK_MS = 350;
  const DOUBLE_CLICK_JITTER = 5;

  function startDrag(event: MouseEvent, windowState: WindowState) {
    if (event.target instanceof Element && event.target.closest("button")) return;

    focusWindow(windowState.id);

    // Detect a double-click on the titlebar manually so it works reliably
    // even though focusWindow + drag state mutate on every mousedown.
    const now = event.timeStamp;
    if (
      lastTitleClick &&
      lastTitleClick.id === windowState.id &&
      now - lastTitleClick.time < DOUBLE_CLICK_MS &&
      Math.abs(event.clientX - lastTitleClick.x) < DOUBLE_CLICK_JITTER &&
      Math.abs(event.clientY - lastTitleClick.y) < DOUBLE_CLICK_JITTER
    ) {
      lastTitleClick = null;
      toggleMaximize(windowState.id);
      return;
    }
    lastTitleClick = { id: windowState.id, time: now, x: event.clientX, y: event.clientY };

    // Maximized windows don't drag, but the double-click above still toggles them.
    if (windowState.maximized) return;

    // Dragging a snapped window restores it to a free-floating size.
    if (windowState.snap && windowState.restoreRect) {
      const restored = windowState.restoreRect;
      windows = windows.map((w) =>
        w.id === windowState.id
          ? { ...w, ...restored, snap: null, restoreRect: null }
          : w,
      );
    }

    // Use the restored geometry (if any) as the drag origin.
    const current = windows.find((w) => w.id === windowState.id) ?? windowState;

    drag = {
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

  function startResize(event: MouseEvent, windowState: WindowState, edges: DragEdge[]) {
    if (windowState.maximized) return;
    event.stopPropagation();
    event.preventDefault();
    focusWindow(windowState.id);

    // Resizing a snapped window restores free geometry first.
    if (windowState.snap && windowState.restoreRect) {
      const restored = windowState.restoreRect;
      windows = windows.map((w) =>
        w.id === windowState.id
          ? { ...w, ...restored, snap: null, restoreRect: null }
          : w,
      );
    }

    const current = windows.find((w) => w.id === windowState.id) ?? windowState;
    drag = {
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

  function handleDesktopContextMenu(event: MouseEvent) {
    event.preventDefault();
    selectedIcon = null;
    startOpen = false;

    contextMenu = {
      x: Math.min(event.clientX, window.innerWidth - 228),
      y: Math.min(event.clientY, window.innerHeight - 290),
    };
  }

  function showToast(message: string) {
    toast = message;
    window.setTimeout(() => {
      if (toast === message) toast = "";
    }, 1800);
  }

  // ---- Workspace ----
  function openWorkspaceSettings() {
    openApp("settings");
    // Defer the anchor until the settings window has mounted.
    window.setTimeout(() => {
      document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  }

  async function connectWorkspace() {
    const ok = await workspace.connect();
    if (ok) {
      const where = workspace.backend === "native" ? "native folder" : "browser storage";
      showToast(`Workspace connected (${where})`);
    } else if (workspace.error) {
      showToast(`Workspace error: ${workspace.error}`);
    } else {
      showToast("Workspace not connected (cancelled or denied)");
    }
  }

  async function disconnectWorkspace() {
    await workspace.disconnect();
    showToast("Workspace disconnected");
  }

  /** Forget any persisted handle and clear the seeded flag, so a fresh connect
   *  starts clean. Useful if the stored handle is stale or corrupt. */
  function resetWorkspaceState() {
    localStorage.removeItem("nd-os-web:workspace-seeded");
    // Clear any persisted FSA handle via the backend (best effort).
    workspace.disconnect().then(() => {
      showToast("Workspace state reset — click Connect to start fresh");
    });
  }

  let notesSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function saveNotes() {
    // When the workspace is connected, the source of truth is /Notes.md.
    // Otherwise fall back to localStorage so the app stays usable offline.
    if (workspace.status === "connected") {
      if (notesSaveTimer) clearTimeout(notesSaveTimer);
      notesSaveTimer = setTimeout(async () => {
        try {
          await workspace.writeFile("/Notes.md", notes);
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Notes save failed");
        }
      }, 400);
    } else {
      localStorage.setItem("nd-os-web:notes", notes);
    }
  }

  async function loadNotesFromWorkspace() {
    if (workspace.status !== "connected") return;
    try {
      notes = await workspace.readFile("/Notes.md");
    } catch {
      // No Notes.md yet — leave the existing content; the next save will create it.
    }
  }

  // ---- Calculator ----
  function calcInput(digit: string) {
    if (calcFresh) {
      calcDisplay = digit === "." ? "0." : digit;
      calcFresh = false;
    } else {
      if (digit === "." && calcDisplay.includes(".")) return;
      calcDisplay = calcDisplay === "0" && digit !== "." ? digit : calcDisplay + digit;
    }
  }

  function calcOperator(op: "+" | "-" | "*" | "/") {
    const current = parseFloat(calcDisplay);
    if (calcPending) {
      const result = calcPending(current);
      calcDisplay = String(result);
    }
    const ops: Record<string, (a: number, b: number) => number> = {
      "+": (a, b) => a + b,
      "-": (a, b) => a - b,
      "*": (a, b) => a * b,
      "/": (a, b) => (b === 0 ? NaN : a / b),
    };
    calcPending = (b) => ops[op](current, b);
    calcFresh = true;
  }

  function calcEquals() {
    if (!calcPending) return;
    const current = parseFloat(calcDisplay);
    const result = calcPending(current);
    calcDisplay = Number.isFinite(result) ? String(result) : "Error";
    calcPending = null;
    calcFresh = true;
  }

  function calcClear() {
    calcDisplay = "0";
    calcPending = null;
    calcFresh = true;
  }

  // ---- Terminal ----
  // Terminal keeps its own cwd (separate from the Files app's), starting at /.
  let termCwd = "/";

  async function runTerminalCommand() {
    const raw = termInput.trim();
    const argv = raw.split(/\s+/);
    const cmd = argv[0]?.toLowerCase() ?? "";
    const out = (text: string) => termLines.push({ kind: "out", text });
    termLines.push({ kind: "in", text: raw });

    // Resolve a path argument against the terminal cwd (supports absolute/relative).
    const resolve = (arg?: string): string => {
      if (!arg) return termCwd;
      if (arg.startsWith("/")) return arg;
      return joinPath(termCwd, arg);
    };

    switch (cmd) {
      case "":
        break;
      case "help":
        out("Available commands:");
        out("  help          Show this help");
        out("  echo <txt>    Print text");
        out("  date          Current date and time");
        out("  whoami        Current user");
        out("  apps          List installed apps");
        out("  open <app>    Open an app");
        out("  clear         Clear the screen");
        out("Workspace (requires connection):");
        out("  pwd           Print working directory");
        out("  ls [path]     List directory contents");
        out("  cat <path>    Print file contents");
        out("  cd <path>     Change directory");
        out("  touch <path>  Create empty file");
        out("  mkdir <path>  Create directory");
        out("  rm <path>     Remove file or directory");
        out("  write <p> <t> Write text to a file");
        out("  edit <path>   Open file in Text Editor");
        out("  connect       Connect the workspace");
        break;
      case "echo":
        out(raw.slice(raw.indexOf(" ") + 1));
        break;
      case "date":
        out(new Date().toString());
        break;
      case "whoami":
        out("guest@nd-os-web");
        break;
      case "apps":
        out(Object.keys(appCatalog).join("  "));
        break;
      case "open": {
        const target = argv[1]?.toLowerCase();
        if (target && appCatalog[target as AppId]) {
          openApp(target as AppId);
          out(`Opening ${target}…`);
        } else {
          out(`open: unknown app '${target ?? ""}'`);
        }
        break;
      }
      case "clear":
        termLines = [];
        break;
      case "connect":
        await connectWorkspace();
        out(workspace.status === "connected" ? `Connected (${workspace.backend})` : "Not connected");
        break;
      case "pwd":
        if (!ensureTermWorkspace(out)) break;
        out(termCwd);
        break;
      case "ls": {
        if (!ensureTermWorkspace(out)) break;
        const path = resolve(argv[1]);
        try {
          const entries = await workspace.list(path);
          if (entries.length === 0) {
            out("(empty)");
          } else {
            out(entries.map((e) => (e.kind === "directory" ? e.name + "/" : e.name)).join("   "));
          }
        } catch (err) {
          out(`ls: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "cd": {
        if (!ensureTermWorkspace(out)) break;
        const path = resolve(argv[1]);
        try {
          // Verify the directory exists.
          const parent = path.slice(0, path.lastIndexOf("/")) || "/";
          const name = path.slice(path.lastIndexOf("/") + 1);
          if (name) {
            const entries = await workspace.list(parent);
            const entry = entries.find((e) => e.name === name);
            if (!entry) {
              out(`cd: no such directory: ${path}`);
              break;
            }
            if (entry.kind !== "directory") {
              out(`cd: not a directory: ${path}`);
              break;
            }
          }
          termCwd = path;
        } catch (err) {
          out(`cd: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "cat": {
        if (!ensureTermWorkspace(out)) break;
        try {
          const content = await workspace.readFile(resolve(argv[1]));
          content.split("\n").forEach((line) => out(line));
        } catch (err) {
          out(`cat: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "touch": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("touch: missing file operand");
          break;
        }
        try {
          await workspace.createFile(resolve(argv[1]));
        } catch (err) {
          out(`touch: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "mkdir": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("mkdir: missing operand");
          break;
        }
        try {
          await workspace.createDir(resolve(argv[1]));
        } catch (err) {
          out(`mkdir: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "rm": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("rm: missing operand");
          break;
        }
        try {
          await workspace.remove(resolve(argv[1]));
        } catch (err) {
          out(`rm: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "write": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("write: usage: write <path> <text>");
          break;
        }
        const text = raw.slice(raw.indexOf(argv[1]) + argv[1].length).trim();
        try {
          await workspace.writeFile(resolve(argv[1]), text);
          out(`Wrote ${text.length} bytes to ${argv[1]}`);
        } catch (err) {
          out(`write: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "edit": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("edit: missing file operand");
          break;
        }
        await openFileInEditor(resolve(argv[1]));
        out(`Opening ${argv[1]}…`);
        break;
      }
      default:
        out(`command not found: ${cmd}`);
    }
    termInput = "";
    termLines = [...termLines];
  }

  function ensureTermWorkspace(out: (text: string) => void): boolean {
    if (workspace.status !== "connected") {
      out("workspace not connected — run 'connect' first");
      return false;
    }
    return true;
  }

  // ---- Calendar ----
  function calMatrix(date: Date): { day: number | null; today: boolean }[][] {
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();
    const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: number | null; today: boolean }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, today: false });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        today:
          d === today.getDate() &&
          month === today.getMonth() &&
          year === today.getFullYear(),
      });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, today: false });
    const rows: { day: number | null; today: boolean }[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }

  function calPrev() {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  }

  function calNext() {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  }

  function calToday() {
    calCursor = new Date();
  }

  // ---- Files ----
  function iconForFile(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["md", "markdown"].includes(ext)) return "📝";
    if (["txt"].includes(ext)) return "📄";
    if (["json"].includes(ext)) return "🧩";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "🖼️";
    if (["js", "ts", "html", "css", "svelte"].includes(ext)) return "📐";
    return "📄";
  }

  function formatSize(bytes?: number): string {
    if (bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function joinPath(dir: string, name: string): string {
    if (dir === "/") return "/" + name;
    return dir + "/" + name;
  }

  function breadcrumbs(dir: string): { name: string; path: string }[] {
    const crumbs = [{ name: "Workspace", path: "/" }];
    if (dir === "/") return crumbs;
    const parts = dir.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      crumbs.push({ name: part, path: acc });
    }
    return crumbs;
  }

  async function refreshFiles() {
    if (workspace.status !== "connected") {
      filesEntries = [];
      filesError = null;
      return;
    }
    filesLoading = true;
    filesError = null;
    try {
      filesEntries = await workspace.list(filesCwd);
    } catch (err) {
      filesError = err instanceof Error ? err.message : String(err);
      filesEntries = [];
    } finally {
      filesLoading = false;
    }
  }

  // Re-list whenever the cwd or workspace revision changes.
  $: if (hydrated) {
    void filesCwd;
    void workspace.revision;
    void workspace.status;
    refreshFiles();
  }

  // When the workspace *first* connects, adopt the workspace copy of Notes.md.
  // We watch the transition (disconnected → connected) rather than every
  // revision so we don't clobber the user's in-progress edits on each save.
  let prevWorkspaceStatus: string | null = null;
  $: if (hydrated) {
    const status = workspace.status;
    if (prevWorkspaceStatus !== "connected" && status === "connected") {
      loadNotesFromWorkspace();
    }
    prevWorkspaceStatus = status;
  }

  function filesNavigate(dir: string) {
    filesCwd = dir;
    filesSelected = null;
  }

  function filesOpenEntry(entry: { name: string; kind: "file" | "directory" }) {
    const path = joinPath(filesCwd, entry.name);
    if (entry.kind === "directory") {
      filesNavigate(path);
    } else {
      openFileInEditor(path);
    }
  }

  async function filesNewFile() {
    const name = window.prompt("New file name", "untitled.txt");
    if (!name) return;
    try {
      await workspace.createFile(joinPath(filesCwd, name));
      filesSelected = name;
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesNewFolder() {
    const name = window.prompt("New folder name", "New Folder");
    if (!name) return;
    try {
      await workspace.createDir(joinPath(filesCwd, name));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesRename() {
    if (!filesSelected) return;
    const newName = window.prompt("Rename to", filesSelected);
    if (!newName || newName === filesSelected) return;
    try {
      await workspace.rename(joinPath(filesCwd, filesSelected), joinPath(filesCwd, newName));
      filesSelected = newName;
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function filesDelete() {
    if (!filesSelected) return;
    if (!window.confirm(`Delete “${filesSelected}”? This cannot be undone.`)) return;
    try {
      await workspace.remove(joinPath(filesCwd, filesSelected));
      filesSelected = null;
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- Editor ----
  function pushRecent(path: string) {
    editorRecent = [path, ...editorRecent.filter((p) => p !== path)].slice(0, 8);
    localStorage.setItem("nd-os-web:editor-recent", JSON.stringify(editorRecent));
  }

  async function openFileInEditor(path: string) {
    if (workspace.status !== "connected") {
      showToast("Connect the workspace first");
      return;
    }
    try {
      editorContent = await workspace.readFile(path);
      editorPath = path;
      editorDirty = false;
      pushRecent(path);
      openApp("editor");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function editorSave() {
    if (!editorPath) return;
    try {
      await workspace.writeFile(editorPath, editorContent);
      editorDirty = false;
      showToast("Saved");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function editorNew() {
    const name = window.prompt("New file path", "/Documents/untitled.txt");
    if (!name) return;
    try {
      await workspace.createFile(name);
      openFileInEditor(name);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  // Persist editor content as the user types.
  function editorInput() {
    editorDirty = true;
  }

  function toggleTheme() {
    settings = { ...settings, theme: settings.theme === "dark" ? "light" : "dark" };
    contextMenu = null;
  }

  function resetSettings() {
    settings = { ...defaultSettings };
    showToast("Settings reset");
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      startOpen = false;
      contextMenu = null;
      openMenu = null;
      if (spotlightOpen) closeSpotlight();
    }

    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      openApp("settings");
    }

    // Spotlight toggle: Cmd/Ctrl + Space.
    if ((event.metaKey || event.ctrlKey) && event.key === " ") {
      event.preventDefault();
      if (spotlightOpen) closeSpotlight();
      else openSpotlight();
    }
  }

  function handleSpotlightKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      spotlightIndex = Math.min(spotlightIndex + 1, spotlightResults.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      spotlightIndex = Math.max(spotlightIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = spotlightResults[spotlightIndex];
      if (selected) launchFromSpotlight(selected.id);
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div
  class="os-shell"
  style={shellStyle}
  oncontextmenu={handleDesktopContextMenu}
  onclick={() => {
    contextMenu = null;
    selectedIcon = null;
    openMenu = null;
  }}
  role="application"
  aria-label="ND OS Web desktop"
>
  <div class="wallpaper" aria-hidden="true"></div>
  <div class="wallpaper-noise" aria-hidden="true"></div>

  <header class="topbar" onclick={(event) => event.stopPropagation()}>
    <div class="topbar-left">
      <button class="brand-button" onclick={() => (startOpen = !startOpen)} aria-label="Open ND menu">
        <span class="brand-mark">N</span>
        <strong>ND OS Web</strong>
      </button>
      <nav class="menubar" aria-label="App menus">
        {#each menubar as menu (menu.id)}
          <div class="menubar-item">
            <button
              class="menubar-trigger"
              class:bold={menu.id === "app"}
              class:open={openMenu === menu.id}
              onclick={() => (openMenu = openMenu === menu.id ? null : menu.id)}
              onmouseenter={() => openMenu && (openMenu = menu.id)}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu.id}
            >
              {menu.label}
            </button>
            {#if openMenu === menu.id}
              <ul class="menubar-dropdown" role="menu">
                {#each menu.items as item, i}
                  {#if item.type === "separator"}
                    <li class="menu-separator" role="separator" aria-hidden="true"></li>
                  {:else if item.type === "item"}
                    {@const actionItem = item}
                    <li role="none">
                      <button
                        class="menu-action"
                        role="menuitem"
                        disabled={actionItem.disabled}
                        onclick={() => runMenuAction(actionItem.action)}
                      >
                        {actionItem.label}
                      </button>
                    </li>
                  {/if}
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </nav>
    </div>
    <div class="topbar-right">
      <span class="status-dot" title="Browser-only mode"></span>
      <span class="browser-mode">Web mode</span>
      <button
        class="workspace-pill"
        class:native={workspace.status === "connected" && workspace.backend === "native"}
        class:fallback={workspace.status === "connected" && workspace.backend === "fallback"}
        class:connecting={workspace.status === "connecting" || workspace.restoring}
        class:reconnect={workspace.status === "disconnected" && workspace.hasStoredHandle && !workspace.restoring}
        class:off={workspace.status === "disconnected" && !workspace.hasStoredHandle && !workspace.restoring}
        disabled={workspace.status === "connecting" || workspace.restoring}
        onclick={() => {
          if (workspace.status === "connected") openWorkspaceSettings();
          else connectWorkspace();
        }}
        title={workspace.status === "connected"
          ? `Workspace: ${workspace.backend === "native" ? "Native folder" : "Browser storage"} — click for settings`
          : workspace.status === "connecting" || workspace.restoring
            ? "Connecting to workspace..."
            : workspace.hasStoredHandle
              ? "Click to reconnect your workspace"
              : "Workspace not connected — click to set up"}
        aria-label="Workspace status"
      >
        {#if workspace.status === "connecting" || workspace.restoring}
          <span class="workspace-spinner"></span>
          <span>{workspace.restoring ? "Loading..." : "Connecting..."}</span>
        {:else}
          <span class="workspace-pill-dot"></span>
          {#if workspace.status === "connected"}
            {workspace.backend === "native" ? "Native" : "Browser"}
          {:else if workspace.hasStoredHandle}
            Reconnect
          {:else}
            Connect
          {/if}
        {/if}
      </button>
      <button class="topbar-clock" onclick={() => openApp("settings")}>{formatDate(clock)}&nbsp;&nbsp;{formatTime(clock)}</button>
    </div>
  </header>

  <main class="desktop-space">
    <section class="desktop-icons" aria-label="Desktop shortcuts">
      {#each Object.entries(appCatalog) as [id, app]}
        <button
          class:selected={selectedIcon === id}
          class="desktop-icon"
          onclick={(event) => {
            event.stopPropagation();
            selectedIcon = id as AppId;
          }}
          ondblclick={(event) => {
            event.stopPropagation();
            openApp(id as AppId);
          }}
          aria-label={`Open ${app.title}`}
        >
          <span class="desktop-icon-art">{app.icon}</span>
          <span>{app.title}</span>
        </button>
      {/each}
    </section>

    <section class="windows-layer" aria-label="Open windows">
      {#each visibleWindows as windowState (windowState.id)}
        <article
          class:maximized={windowState.maximized}
          class:snapped={Boolean(windowState.snap)}
          class:focused={activeWindow === windowState.id}
          class="app-window"
          style={windowState.maximized
            ? `z-index:${windowState.z}`
            : `left:${windowState.x}px;top:${windowState.y}px;width:min(${windowState.width}px,calc(100vw - 24px));height:min(${windowState.height}px,calc(100vh - 120px));z-index:${windowState.z}`}
          onmousedown={() => focusWindow(windowState.id)}
        >
          <header
            class="window-titlebar"
            onmousedown={(event) => startDrag(event, windowState)}
          >
            <div class="window-traffic" aria-label="Window controls">
              <button class="traffic close" onclick={() => closeWindow(windowState.id)} aria-label="Close"></button>
              <button class="traffic minimize" onclick={() => minimizeWindow(windowState.id)} aria-label="Minimize"></button>
              <button class="traffic maximize" onclick={() => toggleMaximize(windowState.id)} aria-label="Maximize"></button>
            </div>
            <div class="window-title"><span>{windowState.icon}</span><strong>{windowState.title}</strong></div>
            <div class="window-snap-controls" role="group" aria-label="Snap window">
              <button
                class="snap-button"
                class:active={windowState.snap === "left"}
                onclick={(event) => {
                  event.stopPropagation();
                  snapWindow(windowState.id, "left");
                }}
                title="Snap left"
                aria-label="Snap left"
                aria-pressed={windowState.snap === "left"}
              >
                <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-opacity="0.5" />
                  <rect x="2" y="2" width="4.5" height="8" rx="1" fill="currentColor" />
                </svg>
              </button>
              <button
                class="snap-button"
                class:active={windowState.snap === "right"}
                onclick={(event) => {
                  event.stopPropagation();
                  snapWindow(windowState.id, "right");
                }}
                title="Snap right"
                aria-label="Snap right"
                aria-pressed={windowState.snap === "right"}
              >
                <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-opacity="0.5" />
                  <rect x="7.5" y="2" width="4.5" height="8" rx="1" fill="currentColor" />
                </svg>
              </button>
            </div>
          </header>

          <div class="window-content">
            {#if windowState.id === "files"}
              <div class="files-app">
                <div class="app-toolbar">
                  <div><span class="eyebrow">{workspace.status === "connected" ? (workspace.backend === "native" ? "Native folder" : "Browser storage") : workspace.status === "connecting" || workspace.restoring ? "Connecting..." : "Not connected"}</span><h1>Files</h1></div>
                  <div class="files-toolbar">
                    {#if workspace.status === "connected"}
                      <button class="soft-button" onclick={filesNewFile} title="New file">📄 New</button>
                      <button class="soft-button" onclick={filesNewFolder} title="New folder">📁 New</button>
                      <button class="soft-button" onclick={filesRename} disabled={!filesSelected} title="Rename">✎</button>
                      <button class="soft-button danger" onclick={filesDelete} disabled={!filesSelected} title="Delete">🗑</button>
                    {/if}
                  </div>
                </div>

                {#if workspace.status !== "connected"}
                  <div class="files-empty">
                    {#if workspace.status === "connecting" || workspace.restoring}
                      <span class="workspace-spinner button-spinner"></span>
                      <p>{workspace.restoring ? "Loading workspace..." : "Connecting..."}</p>
                    {:else}
                      <span aria-hidden="true">🔌</span>
                      <p>{workspace.hasStoredHandle ? "Reconnect to view your files." : "No workspace connected."}</p>
                      <button class="soft-button" onclick={connectWorkspace}>
                        {workspace.hasStoredHandle
                          ? "Reconnect"
                          : detectBackend() === "native"
                            ? "Connect folder…"
                            : "Connect storage"}
                      </button>
                    {/if}
                  </div>
                {:else}
                  <nav class="files-breadcrumbs" aria-label="Path">
                    {#each breadcrumbs(filesCwd) as crumb, i}
                      {#if i > 0}<span class="bc-sep">›</span>{/if}
                      <button class="bc-item" onclick={() => filesNavigate(crumb.path)}>{crumb.name}</button>
                    {/each}
                  </nav>

                  {#if filesLoading}
                    <div class="files-empty"><p>Loading…</p></div>
                  {:else if filesError}
                    <div class="files-empty"><p class="danger">{filesError}</p></div>
                  {:else if filesEntries.length === 0}
                    <div class="files-empty"><p>This folder is empty.</p></div>
                  {:else}
                    <div class="files-list">
                      {#each filesEntries as entry (entry.name)}
                        <button
                          class="file-row"
                          class:selected={filesSelected === entry.name}
                          onclick={() => (filesSelected = entry.name)}
                          ondblclick={() => filesOpenEntry(entry)}
                          title={entry.kind === "directory" ? "Folder" : `${entry.size ?? 0} bytes`}
                        >
                          <span class="file-row-icon">{entry.kind === "directory" ? "📁" : iconForFile(entry.name)}</span>
                          <span class="file-row-name">{entry.name}</span>
                          <span class="file-row-meta">{entry.kind === "directory" ? "Folder" : formatSize(entry.size)}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {:else if windowState.id === "notes"}
              <div class="notes-app">
                <div class="app-toolbar compact">
                  <div><span class="eyebrow">{workspace.status === "connected" ? "Saved to workspace" : workspace.status === "connecting" || workspace.restoring ? "Connecting..." : "Saved in localStorage"}</span><h1>Notes</h1></div>
                  <span class="save-status">Auto-save</span>
                </div>
                <textarea bind:value={notes} oninput={saveNotes} aria-label="Notes editor"></textarea>
              </div>
            {:else if windowState.id === "settings"}
              <div class="settings-layout">
                <aside class="settings-sidebar">
                  <div class="settings-avatar">N</div>
                  <strong>ND OS Web</strong><span>Browser settings</span>
                  <nav><a href="#appearance">Appearance</a><a href="#workspace">Workspace</a><a href="#taskbar">Taskbar</a><a href="#system">System</a></nav>
                </aside>
                <div class="settings-content">
                  <section id="appearance" class="settings-section">
                    <span class="eyebrow">Personalization</span><h1>Appearance</h1>
                    <div class="setting-row">
                      <div><strong>Theme</strong><small>Choose the interface color mode.</small></div>
                      <div class="segmented">
                        <button class:active={settings.theme === "dark"} onclick={() => (settings = { ...settings, theme: "dark" })}>Dark</button>
                        <button class:active={settings.theme === "light"} onclick={() => (settings = { ...settings, theme: "light" })}>Light</button>
                      </div>
                    </div>
                    <div class="setting-block">
                      <div><strong>Wallpaper</strong><small>Pure CSS backgrounds with no image service.</small></div>
                      <div class="wallpaper-grid">
                        {#each Object.keys(wallpapers) as wallpaper}
                          <button
                            class:active={settings.wallpaper === wallpaper}
                            class="wallpaper-option"
                            style={`background:${wallpapers[wallpaper as Wallpaper]}`}
                            onclick={() => (settings = { ...settings, wallpaper: wallpaper as Wallpaper })}
                            aria-label={`Use ${wallpaper} wallpaper`}
                          ><span>{wallpaper}</span></button>
                        {/each}
                      </div>
                    </div>
                    <div class="setting-row">
                      <div><strong>Accent color</strong><small>Used for highlights and active controls.</small></div>
                      <input class="color-input" type="color" value={settings.accent} oninput={(event) => (settings = { ...settings, accent: event.currentTarget.value })} aria-label="Accent color" />
                    </div>
                  </section>

                  <section id="workspace" class="settings-section">
                    <span class="eyebrow">Storage</span><h2>Workspace</h2>
                    <div class="setting-row">
                      <div>
                        <strong>Connection</strong>
                        <small>
                          {#if workspace.status === "connected"}
                            Connected via {workspace.backend === "native" ? "native folder (real files)" : "browser storage (private)"}.
                          {:else if workspace.status === "connecting" || workspace.restoring}
                            {workspace.restoring ? "Checking for saved workspace..." : "Connecting to workspace, please authorize or wait..."}
                          {:else if workspace.hasStoredHandle}
                            Stored folder found — click Reconnect to re-grant access.
                          {:else}
                            Not connected — pick a folder to store your files.
                          {/if}
                        </small>
                      </div>
                      <div class="workspace-actions">
                        {#if workspace.status === "connected"}
                          <button class="soft-button" onclick={disconnectWorkspace}>Disconnect</button>
                        {:else}
                          <button class="soft-button" onclick={connectWorkspace} disabled={workspace.status === "connecting" || workspace.restoring}>
                            {#if workspace.status === "connecting" || workspace.restoring}
                              <span class="workspace-spinner button-spinner"></span>
                              <span>{workspace.restoring ? "Loading..." : "Connecting..."}</span>
                            {:else}
                              {workspace.hasStoredHandle
                                ? "Reconnect"
                                : detectBackend() === "native"
                                  ? "Connect folder…"
                                  : "Connect storage"}
                            {/if}
                          </button>
                        {/if}
                      </div>
                    </div>
                    {#if workspace.error}
                      <p class="workspace-error">⚠ {workspace.error}</p>
                    {/if}
                    {#if workspace.status !== "connected"}
                      <div class="setting-row">
                        <div><small>Having trouble? Reset wipes any stale stored handle so you can start over.</small></div>
                        <button class="soft-button danger" onclick={resetWorkspaceState}>Reset stored state</button>
                      </div>
                    {/if}
                    <div class="setting-block">
                      <div><strong>How it works</strong><small>Files and notes live in the workspace.</small></div>
                      <p class="workspace-note">
                        {#if detectBackend() === "native"}
                          On this browser you can save files to a real folder on your computer (visible in Finder/Explorer). Reconnect after each browser restart to re-grant access.
                        {:else}
                          This browser doesn't support the File System Access API, so files are stored persistently in your browser's private storage instead. They survive reloads but aren't visible to other apps.
                        {/if}
                      </p>
                    </div>
                  </section>

                  <section id="taskbar" class="settings-section">
                    <span class="eyebrow">Navigation</span><h2>Taskbar</h2>
                    <div class="setting-row">
                      <div><strong>Alignment</strong><small>Position app buttons left or center.</small></div>
                      <div class="segmented">
                        <button class:active={settings.taskbarAlignment === "left"} onclick={() => (settings = { ...settings, taskbarAlignment: "left" })}>Left</button>
                        <button class:active={settings.taskbarAlignment === "center"} onclick={() => (settings = { ...settings, taskbarAlignment: "center" })}>Center</button>
                      </div>
                    </div>
                    <label class="setting-row switch-row">
                      <div><strong>Show clock seconds</strong><small>Add seconds to the top bar clock.</small></div>
                      <input type="checkbox" checked={settings.showSeconds} onchange={(event) => (settings = { ...settings, showSeconds: event.currentTarget.checked })} />
                    </label>
                  </section>

                  <section id="system" class="settings-section">
                    <span class="eyebrow">Starter status</span><h2>System</h2>
                    <div class="system-card">
                      <div><span>Runtime</span><strong>Browser only</strong></div>
                      <div><span>Native bridge</span><strong>Not included</strong></div>
                      <div><span>LLM features</span><strong>Not included</strong></div>
                      <div><span>Persistence</span><strong>localStorage</strong></div>
                    </div>
                    <button class="danger-button" onclick={resetSettings}>Reset settings</button>
                  </section>
                </div>
              </div>
            {:else if windowState.id === "calculator"}
              <div class="calc-app">
                <div class="calc-display" aria-live="polite">{calcDisplay}</div>
                <div class="calc-grid">
                  <button class="calc-key wide soft" onclick={calcClear}>AC</button>
                  <button class="calc-key soft" onclick={() => { calcDisplay = String(parseFloat(calcDisplay) * -1); }}>±</button>
                  <button class="calc-key op" onclick={() => calcOperator("/")} aria-label="Divide">÷</button>

                  <button class="calc-key" onclick={() => calcInput("7")}>7</button>
                  <button class="calc-key" onclick={() => calcInput("8")}>8</button>
                  <button class="calc-key" onclick={() => calcInput("9")}>9</button>
                  <button class="calc-key op" onclick={() => calcOperator("*")} aria-label="Multiply">×</button>

                  <button class="calc-key" onclick={() => calcInput("4")}>4</button>
                  <button class="calc-key" onclick={() => calcInput("5")}>5</button>
                  <button class="calc-key" onclick={() => calcInput("6")}>6</button>
                  <button class="calc-key op" onclick={() => calcOperator("-")} aria-label="Subtract">−</button>

                  <button class="calc-key" onclick={() => calcInput("1")}>1</button>
                  <button class="calc-key" onclick={() => calcInput("2")}>2</button>
                  <button class="calc-key" onclick={() => calcInput("3")}>3</button>
                  <button class="calc-key op" onclick={() => calcOperator("+")} aria-label="Add">+</button>

                  <button class="calc-key wide" onclick={() => calcInput("0")}>0</button>
                  <button class="calc-key" onclick={() => calcInput(".")}>.</button>
                  <button class="calc-key equals" onclick={calcEquals}>=</button>
                </div>
              </div>
            {:else if windowState.id === "terminal"}
              <div class="term-app">
                <div class="term-output">
                  {#each termLines as line}
                    {#if line.kind === "in"}
                      <div class="term-line in"><span class="term-prompt">guest@nd-os-web:{termCwd}$</span>{line.text}</div>
                    {:else}
                      <div class="term-line out">{line.text}</div>
                    {/if}
                  {/each}
                </div>
                <form
                  class="term-input-row"
                  onsubmit={(e) => {
                    e.preventDefault();
                    runTerminalCommand();
                  }}
                >
                  <span class="term-prompt">guest@nd-os-web:{termCwd}$</span>
                  <input
                    class="term-input"
                    bind:value={termInput}
                    autocomplete="off"
                    spellcheck="false"
                    aria-label="Terminal command"
                  />
                </form>
              </div>
            {:else if windowState.id === "calendar"}
              <div class="cal-app">
                <div class="cal-header">
                  <button class="soft-button" onclick={calPrev} aria-label="Previous month">‹</button>
                  <strong>{calCursor.toLocaleString(undefined, { month: "long", year: "numeric" })}</strong>
                  <button class="soft-button" onclick={calNext} aria-label="Next month">›</button>
                  <button class="soft-button today" onclick={calToday}>Today</button>
                </div>
                <div class="cal-weekdays">
                  {#each ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as d}
                    <span>{d}</span>
                  {/each}
                </div>
                <div class="cal-grid">
                  {#each calMatrix(calCursor) as week}
                    {#each week as cell}
                      <div class="cal-cell" class:today={cell.today} class:muted={!cell.day}>
                        {cell.day ?? ""}
                      </div>
                    {/each}
                  {/each}
                </div>
              </div>
            {:else if windowState.id === "editor"}
              <div class="editor-app">
                <div class="app-toolbar">
                  <div>
                    <span class="eyebrow">{editorPath ?? "Unsaved"}</span>
                    <h1>Editor{#if editorDirty}<span class="dirty-dot" title="Unsaved changes">●</span>{/if}</h1>
                  </div>
                  <div class="editor-toolbar">
                    <button class="soft-button" onclick={editorNew} title="New file">New</button>
                    <button class="soft-button" onclick={editorSave} disabled={!editorPath || !editorDirty} title="Save (Cmd/Ctrl+S)">Save</button>
                  </div>
                </div>

                {#if workspace.status !== "connected"}
                  <div class="files-empty">
                    {#if workspace.status === "connecting" || workspace.restoring}
                      <span class="workspace-spinner button-spinner"></span>
                      <p>{workspace.restoring ? "Loading workspace..." : "Connecting..."}</p>
                    {:else}
                      <span aria-hidden="true">🔌</span>
                      <p>Connect the workspace to edit files.</p>
                      <button class="soft-button" onclick={connectWorkspace}>Connect…</button>
                    {/if}
                  </div>
                {:else if !editorPath && editorRecent.length === 0}
                  <div class="files-empty">
                    <span aria-hidden="true">📝</span>
                    <p>No file open.</p>
                    <button class="soft-button" onclick={editorNew}>New file</button>
                  </div>
                {:else if !editorPath}
                  <div class="editor-recent">
                    <span class="eyebrow">Recent</span>
                    {#each editorRecent as path}
                      <button class="file-row" onclick={() => openFileInEditor(path)}>
                        <span class="file-row-icon">{iconForFile(path)}</span>
                        <span class="file-row-name">{path}</span>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <textarea
                    class="editor-textarea"
                    bind:value={editorContent}
                    oninput={editorInput}
                    onkeydown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                        e.preventDefault();
                        editorSave();
                      }
                    }}
                    spellcheck="false"
                    aria-label="File content"
                  ></textarea>
                {/if}
              </div>
            {:else}
              <div class="about-app">
                <div class="about-logo">N</div>
                <span class="eyebrow">Minimal starter</span><h1>ND OS Web</h1>
                <p>A clean browser-only desktop shell without Tauri, Rust, native plugins, terminal tooling, backend services, or LLM features.</p>
                <div class="about-features"><span>Desktop</span><span>Context menu</span><span>Taskbar</span><span>Windows</span><span>Settings</span><span>Persistence</span></div>
                <small>Version 0.1.0 · Svelte + Vite</small>
              </div>
            {/if}
          </div>

          {#if !windowState.maximized}
            <!-- 8 resize handles: 4 edges + 4 corners -->
            <div class="resize-handle resize-n" onmousedown={(e) => startResize(e, windowState, ["top"])}></div>
            <div class="resize-handle resize-s" onmousedown={(e) => startResize(e, windowState, ["bottom"])}></div>
            <div class="resize-handle resize-w" onmousedown={(e) => startResize(e, windowState, ["left"])}></div>
            <div class="resize-handle resize-e" onmousedown={(e) => startResize(e, windowState, ["right"])}></div>
            <div class="resize-handle resize-nw" onmousedown={(e) => startResize(e, windowState, ["top", "left"])}></div>
            <div class="resize-handle resize-ne" onmousedown={(e) => startResize(e, windowState, ["top", "right"])}></div>
            <div class="resize-handle resize-sw" onmousedown={(e) => startResize(e, windowState, ["bottom", "left"])}></div>
            <div class="resize-handle resize-se" onmousedown={(e) => startResize(e, windowState, ["bottom", "right"])}></div>
          {/if}
        </article>
      {/each}
    </section>
  </main>

  {#if startOpen}
    <section class:align-left={settings.taskbarAlignment === "left"} class="start-menu" onclick={(event) => event.stopPropagation()}>
      <div class="start-header"><div class="start-logo">N</div><div><strong>ND OS Web</strong><span>Simple web starter</span></div></div>
      <div class="start-search">⌕&nbsp;&nbsp;Search is ready for your app data</div>
      <div class="start-apps">
        {#each Object.entries(appCatalog) as [id, app]}
          <button onclick={() => openApp(id as AppId)}><span>{app.icon}</span><div><strong>{app.title}</strong><small>{app.description}</small></div></button>
        {/each}
      </div>
      <footer><span>Web-only mode</span><button onclick={() => showToast("No native shutdown action in web mode")}>⏻</button></footer>
    </section>
  {/if}

  {#if contextMenu}
    <nav class="context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} onclick={(event) => event.stopPropagation()} aria-label="Desktop context menu">
      <button onclick={() => showToast("Connect New folder to your storage layer")}><span>📁</span>New folder</button>
      <button onclick={() => showToast("Desktop refreshed")}><span>↻</span>Refresh</button>
      <hr />
      <button onclick={() => openApp("settings")}><span>⚙️</span>Display settings</button>
      <button onclick={toggleTheme}><span>{settings.theme === "dark" ? "☀️" : "🌙"}</span>{settings.theme === "dark" ? "Light mode" : "Dark mode"}</button>
      <hr />
      <button onclick={() => openApp("about")}><span>◈</span>About ND OS Web</button>
    </nav>
  {/if}

  {#if spotlightOpen}
    <div
      class="spotlight-backdrop"
      onclick={closeSpotlight}
      role="presentation"
    >
      <div class="spotlight" onclick={(event) => event.stopPropagation()} role="dialog" aria-label="Spotlight search">
        <div class="spotlight-input-wrap">
          <span class="spotlight-icon" aria-hidden="true">⌕</span>
          <input
            class="spotlight-input"
            placeholder="Search apps…"
            bind:value={spotlightQuery}
            oninput={() => (spotlightIndex = 0)}
            onkeydown={handleSpotlightKeydown}
            aria-label="Search apps"
            autofocus
          />
          <kbd class="spotlight-kbd">Esc</kbd>
        </div>
        {#if spotlightResults.length}
          <ul class="spotlight-results" role="listbox">
            {#each spotlightResults as app, i}
              <li>
                <button
                  class:selected={i === spotlightIndex}
                  class="spotlight-result"
                  onclick={() => launchFromSpotlight(app.id)}
                  onmouseenter={() => (spotlightIndex = i)}
                  role="option"
                  aria-selected={i === spotlightIndex}
                >
                  <span class="spotlight-result-icon">{app.icon}</span>
                  <span class="spotlight-result-text">
                    <strong>{app.title}</strong>
                    <small>{app.description}</small>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="spotlight-empty">No apps match “{spotlightQuery}”.</div>
        {/if}
      </div>
    </div>
  {/if}

  <footer class:align-left={settings.taskbarAlignment === "left"} class="taskbar-wrap" onclick={(event) => event.stopPropagation()}>
    <div class="taskbar">
      <button class:active={startOpen} class="start-button" onclick={() => (startOpen = !startOpen)} aria-label="Start menu"><span>N</span></button>
      <div class="taskbar-divider"></div>
      {#each Object.entries(appCatalog) as [id, app]}
        {@const taskWindow = windows.find((windowState) => windowState.id === id)}
        <button
          class:running={Boolean(taskWindow)}
          class:active={activeWindow === id && !taskWindow?.minimized}
          class="taskbar-app"
          onclick={() => toggleTaskbarApp(id as AppId)}
          aria-label={app.title}
          title={app.title}
        ><span>{app.icon}</span></button>
      {/each}
      <div class="taskbar-divider tray-divider"></div>
      <button class="tray" onclick={() => openApp("settings")} title="Quick settings"><span>⌁</span><span>◉</span></button>
    </div>
  </footer>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>
