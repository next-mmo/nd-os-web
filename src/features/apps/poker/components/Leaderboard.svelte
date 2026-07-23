<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import type { PokerProfile } from "../store/profile";

  type Props = {
    profile: PokerProfile;
    onBack: () => void;
  };

  let { profile, onBack }: Props = $props();
</script>

<div class="flex h-full flex-col gap-4 p-6">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">Local leaderboard</h2>
    <Button variant="ghost" size="sm" onclick={onBack}>Back</Button>
  </div>
  <p class="text-muted-foreground text-sm">
    Saved on this device only. Multiplayer friends keep their own stats.
  </p>
  <div class="bg-muted/40 rounded-2xl border p-4">
    <div class="flex items-center gap-3">
      <div class="bg-background flex h-12 w-12 items-center justify-center rounded-full text-2xl shadow">
        {profile.avatar}
      </div>
      <div>
        <div class="font-semibold">{profile.displayName}</div>
        <div class="text-muted-foreground text-xs">You</div>
      </div>
    </div>
    <dl class="mt-4 grid grid-cols-3 gap-3 text-center">
      <div class="bg-background rounded-xl border p-3">
        <dt class="text-muted-foreground text-xs">Bankroll</dt>
        <dd class="text-sm font-semibold tabular-nums">{profile.bankroll.toLocaleString()}</dd>
      </div>
      <div class="bg-background rounded-xl border p-3">
        <dt class="text-muted-foreground text-xs">Hands</dt>
        <dd class="text-sm font-semibold tabular-nums">{profile.handsPlayed}</dd>
      </div>
      <div class="bg-background rounded-xl border p-3">
        <dt class="text-muted-foreground text-xs">Wins</dt>
        <dd class="text-sm font-semibold tabular-nums">{profile.handsWon}</dd>
      </div>
    </dl>
  </div>
</div>
