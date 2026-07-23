<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";

  type Props = { onBack: () => void };
  let { onBack }: Props = $props();

  const slides = [
    {
      title: "Deal",
      body: "Each player gets two private hole cards. Five community cards are dealt in three streets: flop (3), turn (1), river (1).",
    },
    {
      title: "Betting",
      body: "On your turn you may Fold, Check/Call, Bet/Raise, or go All-In. The gold timer on your name means it is your turn.",
    },
    {
      title: "Best hand",
      body: "Make the best five-card poker hand using any mix of your hole cards and the board. Highest hand (or last player standing) wins the pot.",
    },
    {
      title: "Positions",
      body: "D is the dealer button. SB and BB post blinds. Roles move each hand.",
    },
  ];

  let index = $state(0);
</script>

<div class="flex h-full flex-col gap-4 p-6">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">How to play</h2>
    <Button variant="ghost" size="sm" onclick={onBack}>Back</Button>
  </div>
  <div class="bg-muted/40 flex flex-1 flex-col justify-center rounded-2xl border p-6">
    <div class="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
      {index + 1} / {slides.length}
    </div>
    <h3 class="mb-2 text-xl font-semibold">{slides[index].title}</h3>
    <p class="text-muted-foreground max-w-lg text-sm leading-relaxed">{slides[index].body}</p>
  </div>
  <div class="flex justify-between">
    <Button variant="outline" size="sm" disabled={index === 0} onclick={() => (index -= 1)}
      >Previous</Button
    >
    {#if index < slides.length - 1}
      <Button size="sm" onclick={() => (index += 1)}>Next</Button>
    {:else}
      <Button size="sm" onclick={onBack}>Done</Button>
    {/if}
  </div>
</div>
