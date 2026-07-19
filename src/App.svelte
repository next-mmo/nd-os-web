<script lang="ts">
  import { onMount } from "svelte";

  type AppId = "files" | "notes" | "settings" | "about";
  type Theme = "dark" | "light";
  type Wallpaper = "aurora" | "midnight" | "sunrise" | "forest";
  type TaskbarAlignment = "center" | "left";

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
    z: number;
  };

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
  let notes = "Welcome to ND OS Web.\n\nThis note is stored only in your browser.";
  let clock = new Date();
  let toast = "";
  let zCounter = 10;
  let hydrated = false;
  let drag:
    | {
        id: AppId;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
      }
    | null = null;

  $: visibleWindows = windows.filter((windowState) => !windowState.minimized);
  $: activeWindow = windows.length
    ? [...windows].sort((a, b) => b.z - a.z).find((windowState) => !windowState.minimized)?.id ?? null
    : null;
  $: shellStyle = `--wallpaper:${wallpapers[settings.wallpaper]};--accent:${settings.accent}`;

  $: if (hydrated) {
    localStorage.setItem("nd-os-web:settings", JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }

  onMount(() => {
    const storedSettings = localStorage.getItem("nd-os-web:settings");
    const storedNotes = localStorage.getItem("nd-os-web:notes");

    if (storedSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(storedSettings) };
      } catch {
        settings = { ...defaultSettings };
      }
    }

    if (storedNotes !== null) notes = storedNotes;

    document.documentElement.dataset.theme = settings.theme;
    hydrated = true;

    const timer = window.setInterval(() => {
      clock = new Date();
    }, 1000);

    const handleMove = (event: MouseEvent) => {
      if (!drag) return;

      const nextX = Math.max(0, Math.min(window.innerWidth - 280, drag.originX + event.clientX - drag.startX));
      const nextY = Math.max(38, Math.min(window.innerHeight - 140, drag.originY + event.clientY - drag.startY));

      windows = windows.map((windowState) =>
        windowState.id === drag?.id ? { ...windowState, x: nextX, y: nextY } : windowState,
      );
    };

    const handleUp = () => {
      drag = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
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
        x: Math.min(120 + offset, Math.max(18, window.innerWidth - 700)),
        y: Math.min(86 + offset, Math.max(50, window.innerHeight - 520)),
        width: id === "settings" ? 760 : 680,
        height: id === "settings" ? 500 : 450,
        minimized: false,
        maximized: false,
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
        ? { ...windowState, maximized: !windowState.maximized, minimized: false }
        : windowState,
    );
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

  function startDrag(event: MouseEvent, windowState: WindowState) {
    if (windowState.maximized) return;
    if (event.target instanceof Element && event.target.closest("button")) return;

    focusWindow(windowState.id);
    drag = {
      id: windowState.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: windowState.x,
      originY: windowState.y,
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

  function saveNotes() {
    localStorage.setItem("nd-os-web:notes", notes);
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
    }

    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      openApp("settings");
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
      <span class="topbar-app">{activeWindow ? appCatalog[activeWindow].title : "Desktop"}</span>
    </div>
    <div class="topbar-right">
      <span class="status-dot" title="Browser-only mode"></span>
      <span class="browser-mode">Web mode</span>
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
            ondblclick={() => toggleMaximize(windowState.id)}
          >
            <div class="window-traffic" aria-label="Window controls">
              <button class="traffic close" onclick={() => closeWindow(windowState.id)} aria-label="Close"></button>
              <button class="traffic minimize" onclick={() => minimizeWindow(windowState.id)} aria-label="Minimize"></button>
              <button class="traffic maximize" onclick={() => toggleMaximize(windowState.id)} aria-label="Maximize"></button>
            </div>
            <div class="window-title"><span>{windowState.icon}</span><strong>{windowState.title}</strong></div>
            <div></div>
          </header>

          <div class="window-content">
            {#if windowState.id === "files"}
              <div class="app-toolbar">
                <div><span class="eyebrow">Local demo</span><h1>Files</h1></div>
                <button class="soft-button" onclick={() => showToast("Connect this action to your web storage API")}>＋ New</button>
              </div>
              <div class="file-grid">
                {#each [
                  ["📁", "Documents", "Starter folder"],
                  ["🖼️", "Pictures", "Starter folder"],
                  ["⬇️", "Downloads", "Starter folder"],
                  ["📄", "Welcome.txt", "Browser demo file"],
                ] as file}
                  <button class="file-card" onclick={() => showToast(`${file[1]} selected`)}>
                    <span>{file[0]}</span><strong>{file[1]}</strong><small>{file[2]}</small>
                  </button>
                {/each}
              </div>
              <p class="empty-note">No native filesystem access. Add REST, cloud storage, IndexedDB, or your own backend here.</p>
            {:else if windowState.id === "notes"}
              <div class="notes-app">
                <div class="app-toolbar compact">
                  <div><span class="eyebrow">Saved in localStorage</span><h1>Notes</h1></div>
                  <span class="save-status">Auto-save</span>
                </div>
                <textarea bind:value={notes} oninput={saveNotes} aria-label="Notes editor"></textarea>
              </div>
            {:else if windowState.id === "settings"}
              <div class="settings-layout">
                <aside class="settings-sidebar">
                  <div class="settings-avatar">N</div>
                  <strong>ND OS Web</strong><span>Browser settings</span>
                  <nav><a href="#appearance">Appearance</a><a href="#taskbar">Taskbar</a><a href="#system">System</a></nav>
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
