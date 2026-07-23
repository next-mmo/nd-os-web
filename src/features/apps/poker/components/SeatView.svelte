<script lang="ts">
  import { cn } from "$lib/utils.js";
  import type { SeatState, Stage } from "../engine/types";
  import CardView from "./CardView.svelte";

  type Props = {
    seat: SeatState;
    stage: Stage;
    isYou: boolean;
    isActing: boolean;
    holeFaceDown: boolean;
    dealer: boolean;
    sb: boolean;
    bb: boolean;
    turnRatio: number;
    canSit: boolean;
    onSit: () => void;
  };

  let {
    seat,
    stage,
    isYou,
    isActing,
    holeFaceDown,
    dealer,
    sb,
    bb,
    turnRatio,
    canSit,
    onSit,
  }: Props = $props();

  const empty = $derived(!seat.player);
  const showCards = $derived(
    !empty &&
      (seat.holeCards.length > 0 || holeFaceDown) &&
      (stage === "preflop" ||
        stage === "flop" ||
        stage === "turn" ||
        stage === "river" ||
        stage === "showdown" ||
        stage === "countdown" ||
        stage === "waiting"),
  );
</script>

{#if empty}
  <button
    type="button"
    class="seat empty border-muted-foreground/40 hover:border-primary hover:bg-primary/10 flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-dashed transition disabled:cursor-not-allowed disabled:opacity-40"
    disabled={!canSit}
    onclick={onSit}
    aria-label="Sit here"
  >
    <span class="text-2xl opacity-60">○</span>
    <span class="text-muted-foreground mt-1 text-xs">Sit</span>
  </button>
{:else}
  <div class="seat occupied relative flex w-32 flex-col items-center gap-1">
    <div class="relative">
      <div
        class="bg-muted flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow"
        class:ring-2={seat.isWinner}
        class:ring-amber-400={seat.isWinner}
      >
        {seat.player?.avatar}
      </div>
      <div class="absolute -right-1 -top-1 flex flex-col gap-0.5">
        {#if dealer}
          <span class="rounded-full bg-white px-1.5 text-[10px] font-bold text-black shadow">D</span>
        {/if}
        {#if sb}
          <span class="rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white shadow">SB</span>
        {/if}
        {#if bb}
          <span class="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white shadow">BB</span>
        {/if}
      </div>
    </div>

    <div
      class={cn(
        "name-pill relative overflow-hidden rounded-full px-2.5 py-1 text-center text-xs",
        isYou ? "bg-primary text-primary-foreground" : "bg-background/90 border",
      )}
    >
      {#if isActing}
        <div
          class="timer-ring pointer-events-none absolute inset-0 rounded-full"
          style={`--turn: ${Math.max(0, Math.min(1, turnRatio))}`}
        ></div>
      {/if}
      <div class="relative z-10 font-medium">{isYou ? "You" : seat.player?.name}</div>
      <div class="relative z-10 tabular-nums opacity-90">
        {(seat.player?.chips ?? 0).toLocaleString()}
      </div>
    </div>

    {#if seat.currentBet > 0}
      <div class="bg-amber-500/90 rounded-full px-2 py-0.5 text-[10px] font-semibold text-black">
        {seat.currentBet.toLocaleString()}
      </div>
    {/if}

    {#if showCards && seat.status !== "folded"}
      <div class="mt-0.5 flex gap-1">
        {#if holeFaceDown}
          <CardView faceDown small />
          <CardView faceDown small />
        {:else}
          {#each seat.holeCards as card}
            <CardView {card} small />
          {/each}
        {/if}
      </div>
    {:else if seat.status === "folded"}
      <div class="text-muted-foreground text-[10px] uppercase tracking-wide">Folded</div>
    {/if}
  </div>
{/if}

<style>
  .timer-ring {
    box-shadow: inset 0 0 0 2px
      color-mix(in oklab, #eab308 calc(var(--turn) * 100%), #ef4444);
    opacity: 0.95;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    padding: 2px;
    background: conic-gradient(
      #eab308 calc(var(--turn) * 360deg),
      transparent 0
    );
  }
</style>
