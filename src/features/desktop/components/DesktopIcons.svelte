<script lang="ts">
  import { onMount } from "svelte";
  import { appCatalog } from "@/features/desktop/catalog";
  import { desktopIcons } from "@/features/desktop/desktop-icons.svelte";
  import type { AppId } from "@/features/desktop/types";
  import { cn } from "$lib/utils.js";

  type Props = {
    selectedIcon: AppId | null;
    onSelect: (id: AppId) => void;
    onOpen: (id: AppId) => void;
  };

  let { selectedIcon, onSelect, onOpen }: Props = $props();

  let layerEl: HTMLElement | null = $state(null);
  let draggingId: AppId | null = $state(null);

  type DragState = {
    id: AppId;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  };

  let drag: DragState | null = null;

  function bounds() {
    const el = layerEl;
    if (!el) return { width: window.innerWidth, height: window.innerHeight };
    return { width: el.clientWidth, height: el.clientHeight };
  }

  function onPointerDown(event: PointerEvent, id: AppId) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    const pos = desktopIcons.positions[id];
    drag = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: pos.x,
      originY: pos.y,
      moved: false,
    };
    draggingId = id;
    onSelect(id);

    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    desktopIcons.move(drag.id, drag.originX + dx, drag.originY + dy, bounds());
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag) return;
    const { id, moved, originX, originY, startX, startY } = drag;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (moved) {
      desktopIcons.drop(id, originX + dx, originY + dy, bounds());
    } else {
      onSelect(id);
    }

    drag = null;
    draggingId = null;
  }

  function onDoubleClick(event: MouseEvent, id: AppId) {
    event.stopPropagation();
    onOpen(id);
  }

  onMount(() => {
    // Unstack any overlapping icons from older saves / tight drops.
    desktopIcons.resolveOverlaps(bounds());
  });
</script>

<section
  class="desktop-icons"
  aria-label="Desktop shortcuts"
  bind:this={layerEl}
>
  {#each Object.entries(appCatalog) as [id, app]}
    {@const pos = desktopIcons.positions[id as AppId]}
    <button
      type="button"
      class={cn(
        "desktop-icon",
        selectedIcon === id && "selected",
        draggingId === id && "dragging",
      )}
      style={`left:${pos.x}px;top:${pos.y}px`}
      onpointerdown={(e) => onPointerDown(e, id as AppId)}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      ondblclick={(e) => onDoubleClick(e, id as AppId)}
      aria-label={`Open ${app.title}`}
    >
      <span class="desktop-icon-art" aria-hidden="true">{app.icon}</span>
      <span>{app.title}</span>
    </button>
  {/each}
</section>
