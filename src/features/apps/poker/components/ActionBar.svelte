<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ActingInfo } from "../engine/types";
  import type { ActionRequest } from "../engine";

  type Props = {
    acting: ActingInfo;
    raiseAmount: number;
    onRaiseAmount: (n: number) => void;
    onAction: (request: ActionRequest) => void;
  };

  let { acting, raiseAmount, onRaiseAmount, onAction }: Props = $props();

  const canRaise = $derived(
    acting.allowedActions.includes("raise") || acting.allowedActions.includes("all-in"),
  );
  const showAllIn = $derived(acting.allowedActions.includes("all-in"));
</script>

<div class="action-bar bg-background/95 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-lg backdrop-blur">
  {#if acting.allowedActions.includes("fold")}
    <Button variant="destructive" size="sm" onclick={() => onAction({ action: "fold" })}>Fold</Button>
  {/if}

  {#if acting.allowedActions.includes("check")}
    <Button variant="secondary" size="sm" onclick={() => onAction({ action: "check" })}>Check</Button>
  {/if}

  {#if acting.allowedActions.includes("call")}
    <Button variant="secondary" size="sm" onclick={() => onAction({ action: "call" })}>
      Call {acting.callAmount > 0 ? acting.callAmount.toLocaleString() : ""}
    </Button>
  {/if}

  {#if canRaise && acting.maxRaise > acting.callAmount}
    <div class="flex min-w-[10rem] flex-1 items-center gap-2">
      <input
        class="accent-primary w-full"
        type="range"
        min={acting.minRaise}
        max={acting.maxRaise}
        step={50}
        value={raiseAmount}
        oninput={(e) => onRaiseAmount(Number(e.currentTarget.value))}
      />
      <span class="text-muted-foreground w-16 text-right text-xs tabular-nums"
        >{raiseAmount.toLocaleString()}</span
      >
    </div>
    <Button
      size="sm"
      onclick={() => onAction({ action: "raise", amount: raiseAmount })}
      disabled={raiseAmount < acting.minRaise}
    >
      {acting.callAmount === 0 ? "Bet" : "Raise"}
    </Button>
  {/if}

  {#if showAllIn}
    <Button
      variant="outline"
      size="sm"
      onclick={() => {
        if (acting.callAmount >= acting.maxRaise && acting.allowedActions.includes("call")) {
          onAction({ action: "call" });
        } else {
          onAction({ action: "raise", amount: acting.maxRaise });
        }
      }}
    >
      All-In
    </Button>
  {/if}
</div>
