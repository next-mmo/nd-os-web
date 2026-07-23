<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ActionRequest, TableState } from "../engine";
  import type { HandResult } from "../engine/types";
  import ActionBar from "./ActionBar.svelte";
  import CardView from "./CardView.svelte";
  import SeatView from "./SeatView.svelte";
  import ShowdownPopup from "./ShowdownPopup.svelte";

  type ViewState = TableState & { holeFaceDown?: boolean[] };

  type Props = {
    table: ViewState;
    mySeatIndex: number | null;
    raiseAmount: number;
    roomCode: string | null;
    statusText: string;
    modeLabel: string;
    onRaiseAmount: (n: number) => void;
    onAction: (request: ActionRequest) => void;
    onSit: (seatIndex: number) => void;
    onLeaveSeat: () => void;
    onLeaveTable: () => void;
    onFillBots?: () => void;
    showFillBots?: boolean;
  };

  let {
    table,
    mySeatIndex,
    raiseAmount,
    roomCode,
    statusText,
    modeLabel,
    onRaiseAmount,
    onAction,
    onSit,
    onLeaveSeat,
    onLeaveTable,
    onFillBots,
    showFillBots = false,
  }: Props = $props();

  let popupResult = $state<HandResult | null>(null);
  let seenResultKey = $state<string | null>(null);
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  const isMyTurn = $derived(
    table.acting !== null && mySeatIndex !== null && table.acting.seatIndex === mySeatIndex,
  );

  const turnRatio = $derived.by(() => {
    if (!table.acting) return 0;
    const left = table.acting.turnEndsAt - Date.now();
    return left / table.config.turnMs;
  });

  const youWon = $derived(
    popupResult !== null &&
      mySeatIndex !== null &&
      popupResult.winners.some((w) => w.seatIndex === mySeatIndex),
  );

  $effect(() => {
    const result = table.lastResult;
    if (!result) return;
    const key = `${table.handNumber}:${result.kind}:${result.potWon}:${result.winners.map((w) => w.seatIndex).join(",")}`;
    if (key === seenResultKey) return;
    seenResultKey = key;
    popupResult = result;
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      popupResult = null;
    }, 4200);
    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  });

  // Hide when next hand deals
  $effect(() => {
    if (table.stage === "preflop" && popupResult) {
      popupResult = null;
    }
  });

  function dismissPopup() {
    popupResult = null;
    if (dismissTimer) clearTimeout(dismissTimer);
  }

  const positions = [
    { top: "78%", left: "50%" },
    { top: "62%", left: "12%" },
    { top: "28%", left: "12%" },
    { top: "10%", left: "50%" },
    { top: "28%", left: "88%" },
    { top: "62%", left: "88%" },
  ];
</script>

<div class="table-view flex h-full min-h-0 flex-col gap-2 p-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <div class="text-sm font-semibold">{modeLabel}</div>
      <div class="text-muted-foreground text-xs">{statusText}</div>
      {#if roomCode}
        <div class="text-xs">
          Room code:
          <code class="bg-muted rounded px-1.5 py-0.5 select-all">{roomCode}</code>
        </div>
      {/if}
    </div>
    <div class="flex gap-2">
      {#if showFillBots && onFillBots}
        <Button variant="secondary" size="sm" onclick={onFillBots}>Add bots</Button>
      {/if}
      {#if mySeatIndex !== null}
        <Button variant="outline" size="sm" onclick={onLeaveSeat}>Stand up</Button>
      {/if}
      <Button variant="ghost" size="sm" onclick={onLeaveTable}>Lobby</Button>
    </div>
  </div>

  <div
    class="felt relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-emerald-900/40 shadow-inner"
  >
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-2">
        <div class="text-xs font-medium tracking-wide text-emerald-100/80 uppercase">
          {table.stage}
          {#if table.handNumber > 0}
            · Hand #{table.handNumber}
          {/if}
        </div>
        <div class="flex min-h-[3.75rem] items-center gap-1.5">
          {#each table.board as card}
            <CardView {card} />
          {/each}
          {#if table.board.length === 0}
            <div class="text-emerald-100/50 text-xs">Community cards</div>
          {/if}
        </div>
        <div class="rounded-full bg-black/35 px-3 py-1 text-sm font-semibold text-amber-200">
          Pot {table.pot.toLocaleString()}
        </div>
        <div class="max-w-[16rem] text-center text-xs text-emerald-50/90">{table.lastMessage}</div>
      </div>
    </div>

    {#if popupResult}
      <ShowdownPopup result={popupResult} {youWon} onDismiss={dismissPopup} />
    {/if}

    {#each table.seats as seat (seat.index)}
      {@const pos = positions[seat.index] ?? positions[0]}
      <div
        class="absolute -translate-x-1/2 -translate-y-1/2"
        style:top={pos.top}
        style:left={pos.left}
      >
        <SeatView
          {seat}
          stage={table.stage}
          isYou={mySeatIndex === seat.index}
          isActing={table.acting?.seatIndex === seat.index}
          holeFaceDown={Boolean(table.holeFaceDown?.[seat.index])}
          dealer={table.dealerIndex === seat.index && table.handNumber > 0}
          sb={table.sbIndex === seat.index && table.handNumber > 0}
          bb={table.bbIndex === seat.index && table.handNumber > 0}
          {turnRatio}
          canSit={mySeatIndex === null && !seat.player}
          onSit={() => onSit(seat.index)}
        />
      </div>
    {/each}
  </div>

  {#if isMyTurn && table.acting}
    <ActionBar
      acting={table.acting}
      {raiseAmount}
      {onRaiseAmount}
      {onAction}
    />
  {:else}
    <div class="text-muted-foreground py-2 text-center text-xs">
      {#if table.stage === "countdown"}
        Next hand starting…
      {:else if mySeatIndex === null}
        Sit at an empty seat to play
      {:else}
        Waiting for other players…
      {/if}
    </div>
  {/if}
</div>

<style>
  .felt {
    background:
      radial-gradient(ellipse at center, rgba(255, 255, 255, 0.08), transparent 55%),
      linear-gradient(160deg, #0f3d2e 0%, #0a2920 45%, #072219 100%);
  }
</style>
