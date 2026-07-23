<script lang="ts">
  import type { HandResult } from "../engine/types";
  import CardView from "./CardView.svelte";

  type Props = {
    result: HandResult;
    youWon: boolean;
    onDismiss: () => void;
  };

  let { result, youWon, onDismiss }: Props = $props();

  const title = $derived(
    result.kind === "fold"
      ? "Winner by fold"
      : result.winners.length > 1
        ? "Split pot"
        : "Showdown",
  );

  const primary = $derived(result.winners[0]);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="showdown-backdrop" onclick={onDismiss} role="presentation">
  <div
    class="showdown-panel"
    class:you-won={youWon}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="showdown-title"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sparkles" aria-hidden="true">
      {#each Array.from({ length: 12 }, (_, i) => i) as i}
        <span
          class="spark"
          style={`--i:${i}; --x:${8 + ((i * 17) % 84)}%; --y:${10 + ((i * 23) % 70)}%`}
        ></span>
      {/each}
    </div>

    <p class="eyebrow">{title}</p>
    <h2 id="showdown-title" class="headline">
      {#if youWon}
        You win!
      {:else}
        {primary?.name ?? "Winner"} wins
      {/if}
    </h2>

    {#if primary}
      <div class="winner-row">
        <div class="avatar" aria-hidden="true">{primary.avatar}</div>
        <div>
          <div class="winner-name">{primary.name}</div>
          <div class="hand-name">{primary.handName}</div>
        </div>
      </div>
    {/if}

    <div class="amount" aria-live="polite">
      <span class="amount-label">Pot</span>
      <span class="amount-value">+{result.potWon.toLocaleString()}</span>
    </div>

    {#if primary?.holeCards?.length}
      <div class="cards-block">
        <div class="cards-label">Hole</div>
        <div class="cards-row">
          {#each primary.holeCards as card, i}
            <div class="card-slot" style={`--delay:${120 + i * 90}ms`}>
              <CardView {card} glow />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if result.board.length}
      <div class="cards-block">
        <div class="cards-label">Board</div>
        <div class="cards-row board">
          {#each result.board as card, i}
            <div class="card-slot" style={`--delay:${280 + i * 70}ms`}>
              <CardView {card} small />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if result.winners.length > 1}
      <ul class="split-list">
        {#each result.winners as w}
          <li>
            <span>{w.avatar} {w.name}</span>
            <span class="tabular-nums">+{w.amount.toLocaleString()}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <button type="button" class="dismiss" onclick={onDismiss}>Continue</button>
  </div>
</div>

<style>
  .showdown-backdrop {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.72));
    animation: backdrop-in 280ms ease-out both;
  }

  .showdown-panel {
    position: relative;
    width: min(22rem, 100%);
    overflow: hidden;
    border-radius: 1.25rem;
    border: 1px solid color-mix(in oklab, #f5d78e 45%, transparent);
    background:
      linear-gradient(165deg, rgba(28, 24, 18, 0.96), rgba(12, 18, 16, 0.97)),
      radial-gradient(ellipse at top, rgba(245, 215, 142, 0.12), transparent 55%);
    color: #f7f1e4;
    padding: 1.35rem 1.25rem 1.1rem;
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    animation: panel-in 480ms cubic-bezier(0.22, 1.2, 0.36, 1) both;
    text-align: center;
  }

  .showdown-panel.you-won {
    border-color: color-mix(in oklab, #f0c14b 70%, transparent);
  }

  .eyebrow {
    margin: 0;
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(245, 215, 142, 0.75);
    animation: fade-up 360ms ease-out both;
  }

  .headline {
    margin: 0.35rem 0 0;
    font-size: 1.65rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    animation: fade-up 420ms 60ms ease-out both;
  }

  .winner-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 1rem;
    animation: fade-up 420ms 100ms ease-out both;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    font-size: 1.5rem;
    box-shadow: 0 0 0 2px rgba(240, 193, 75, 0.45);
    animation: avatar-pulse 1.6s ease-in-out infinite;
  }

  .winner-name {
    font-weight: 600;
    text-align: left;
  }

  .hand-name {
    font-size: 0.8rem;
    color: rgba(245, 215, 142, 0.85);
    text-align: left;
  }

  .amount {
    margin: 1rem auto 0.25rem;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    min-width: 8rem;
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    background: rgba(240, 193, 75, 0.12);
    border: 1px solid rgba(240, 193, 75, 0.35);
    animation: amount-pop 520ms 160ms cubic-bezier(0.22, 1.35, 0.36, 1) both;
  }

  .amount-label {
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(247, 241, 228, 0.65);
  }

  .amount-value {
    font-size: 1.45rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #f0c14b;
  }

  .cards-block {
    margin-top: 0.9rem;
  }

  .cards-label {
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(247, 241, 228, 0.55);
    margin-bottom: 0.35rem;
  }

  .cards-row {
    display: flex;
    justify-content: center;
    gap: 0.35rem;
  }

  .cards-row.board {
    gap: 0.25rem;
  }

  .card-slot {
    animation: card-flip 460ms var(--delay, 0ms) cubic-bezier(0.22, 1.2, 0.36, 1) both;
    transform-origin: center bottom;
  }

  .split-list {
    list-style: none;
    margin: 0.85rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: rgba(247, 241, 228, 0.85);
  }

  .split-list li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35rem 0.6rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .dismiss {
    margin-top: 1.1rem;
    width: 100%;
    border: 0;
    border-radius: 0.75rem;
    padding: 0.55rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #1a1510;
    background: linear-gradient(180deg, #f5d78e, #e0b24a);
    cursor: pointer;
    animation: fade-up 400ms 280ms ease-out both;
  }

  .dismiss:hover {
    filter: brightness(1.05);
  }

  .sparkles {
    pointer-events: none;
    position: absolute;
    inset: 0;
  }

  .spark {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: #f5d78e;
    opacity: 0;
    animation: spark 1.8s calc(var(--i) * 90ms) ease-in-out infinite;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes amount-pop {
    from {
      opacity: 0;
      transform: scale(0.7);
    }
    70% {
      transform: scale(1.06);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes card-flip {
    from {
      opacity: 0;
      transform: rotateY(75deg) translateY(12px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: rotateY(0) translateY(0) scale(1);
    }
  }

  @keyframes avatar-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 2px rgba(240, 193, 75, 0.4);
    }
    50% {
      box-shadow:
        0 0 0 4px rgba(240, 193, 75, 0.25),
        0 0 22px rgba(240, 193, 75, 0.35);
    }
  }

  @keyframes spark {
    0%,
    100% {
      opacity: 0;
      transform: translateY(0) scale(0.4);
    }
    40% {
      opacity: 0.9;
      transform: translateY(-10px) scale(1);
    }
    70% {
      opacity: 0.2;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .showdown-backdrop,
    .showdown-panel,
    .eyebrow,
    .headline,
    .winner-row,
    .amount,
    .card-slot,
    .dismiss,
    .spark,
    .avatar {
      animation: none !important;
    }
  }
</style>
