<script lang="ts">
  import { formatCard, isRed } from "../engine";
  import type { Card } from "../engine";

  type Props = {
    card?: Card | null;
    faceDown?: boolean;
    small?: boolean;
    glow?: boolean;
  };

  let { card = null, faceDown = false, small = false, glow = false }: Props = $props();
</script>

{#if faceDown || !card}
  <div
    class="card-view face-down inline-flex items-center justify-center rounded-md border border-white/20 bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-sm"
    class:small
    aria-label="Face-down card"
  >
    <span class="opacity-80">❧</span>
  </div>
{:else}
  <div
    class="card-view inline-flex items-center justify-center rounded-md border bg-white shadow-sm"
    class:small
    class:glow
    class:red={isRed(card)}
    class:black={!isRed(card)}
    aria-label={formatCard(card)}
  >
    <span class="font-semibold tracking-tight">{formatCard(card)}</span>
  </div>
{/if}

<style>
  .card-view {
    width: 2.75rem;
    height: 3.75rem;
    font-size: 0.85rem;
  }
  .card-view.small {
    width: 2rem;
    height: 2.75rem;
    font-size: 0.7rem;
  }
  .card-view.red {
    color: #c02323;
  }
  .card-view.black {
    color: #1a1a1a;
  }
  .card-view.glow {
    box-shadow:
      0 0 0 1px rgba(240, 193, 75, 0.55),
      0 0 14px rgba(240, 193, 75, 0.45);
  }
</style>
