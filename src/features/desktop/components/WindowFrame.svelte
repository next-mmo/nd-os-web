<script lang="ts">
  import { appRegistry } from "@/features/apps/registry";
  import type { DragEdge, WindowState } from "@/features/desktop/types";
  import { windowManager } from "@/features/desktop/window-manager.svelte";

  type Props = {
    windowState: WindowState;
    focused: boolean;
  };

  let { windowState, focused }: Props = $props();

  const AppComponent = $derived(appRegistry[windowState.id]);
</script>

<article
  class:maximized={windowState.maximized}
  class:snapped={Boolean(windowState.snap)}
  class:focused
  class="app-window"
  style={windowState.maximized
    ? `z-index:${windowState.z}`
    : `left:${windowState.x}px;top:${windowState.y}px;width:min(${windowState.width}px,calc(100vw - 24px));height:min(${windowState.height}px,calc(100vh - 120px));z-index:${windowState.z}`}
  onmousedown={() => windowManager.focus(windowState.id)}
>
  <header
    class="window-titlebar"
    onmousedown={(event) => windowManager.startDrag(event, windowState)}
  >
    <div class="window-traffic" aria-label="Window controls">
      <button
        class="traffic close"
        onclick={() => windowManager.close(windowState.id)}
        aria-label="Close"
      ></button>
      <button
        class="traffic minimize"
        onclick={() => windowManager.minimize(windowState.id)}
        aria-label="Minimize"
      ></button>
      <button
        class="traffic maximize"
        onclick={() => windowManager.toggleMaximize(windowState.id)}
        aria-label="Maximize"
      ></button>
    </div>
    <div class="window-title"
      ><span>{windowState.icon}</span><strong>{windowState.title}</strong></div
    >
    <div class="window-snap-controls" role="group" aria-label="Snap window">
      <button
        class="snap-button"
        class:active={windowState.snap === "left"}
        onclick={(event) => {
          event.stopPropagation();
          windowManager.snap(windowState.id, "left");
        }}
        title="Snap left"
        aria-label="Snap left"
        aria-pressed={windowState.snap === "left"}
      >
        <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="13"
            height="11"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.5"
          />
          <rect x="2" y="2" width="4.5" height="8" rx="1" fill="currentColor" />
        </svg>
      </button>
      <button
        class="snap-button"
        class:active={windowState.snap === "right"}
        onclick={(event) => {
          event.stopPropagation();
          windowManager.snap(windowState.id, "right");
        }}
        title="Snap right"
        aria-label="Snap right"
        aria-pressed={windowState.snap === "right"}
      >
        <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="13"
            height="11"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.5"
          />
          <rect x="7.5" y="2" width="4.5" height="8" rx="1" fill="currentColor" />
        </svg>
      </button>
    </div>
  </header>

  <div class="window-content">
    <AppComponent />
  </div>

  {#if !windowState.maximized}
    <div
      class="resize-handle resize-n"
      onmousedown={(e) => windowManager.startResize(e, windowState, ["top"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-s"
      onmousedown={(e) => windowManager.startResize(e, windowState, ["bottom"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-w"
      onmousedown={(e) => windowManager.startResize(e, windowState, ["left"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-e"
      onmousedown={(e) => windowManager.startResize(e, windowState, ["right"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-nw"
      onmousedown={(e) =>
        windowManager.startResize(e, windowState, ["top", "left"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-ne"
      onmousedown={(e) =>
        windowManager.startResize(e, windowState, ["top", "right"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-sw"
      onmousedown={(e) =>
        windowManager.startResize(e, windowState, ["bottom", "left"] as DragEdge[])}
    ></div>
    <div
      class="resize-handle resize-se"
      onmousedown={(e) =>
        windowManager.startResize(e, windowState, ["bottom", "right"] as DragEdge[])}
    ></div>
  {/if}
</article>
