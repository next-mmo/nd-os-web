<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { AVATARS } from "../engine/types";
  import type { PokerProfile } from "../store/profile";
  import {
    canClaimDaily,
    claimDailyBankroll,
    DAILY_CLAIM_AMOUNT,
    resetBankroll,
    topUpBankroll,
    updateProfile,
  } from "../store/profile";
  import DailyClaimDialog from "./DailyClaimDialog.svelte";

  type Props = {
    profile: PokerProfile;
    connecting: boolean;
    errorText: string;
    resumeAvailable?: boolean;
    resumeHint?: string;
    onProfileChange: (profile: PokerProfile) => void;
    onSolo: () => void;
    onCreateRoom: () => void;
    onJoinRoom: (code: string) => void;
    onResume?: () => void;
    onDiscardResume?: () => void;
    onHowTo: () => void;
    onLeaderboard: () => void;
  };

  let {
    profile,
    connecting,
    errorText,
    resumeAvailable = false,
    resumeHint,
    onProfileChange,
    onSolo,
    onCreateRoom,
    onJoinRoom,
    onResume,
    onDiscardResume,
    onHowTo,
    onLeaderboard,
  }: Props = $props();

  let joinCode = $state("");
  let nameDraft = $state("");
  let claimOpen = $state(false);
  let claimMode = $state<"ready" | "success" | "already">("ready");
  let claimAmount = $state(DAILY_CLAIM_AMOUNT);
  let autoPrompted = $state(false);

  const dailyReady = $derived(canClaimDaily(profile));

  $effect(() => {
    nameDraft = profile.displayName;
  });

  // Soft prompt once when lobby opens and claim is available.
  $effect(() => {
    if (!autoPrompted && dailyReady) {
      autoPrompted = true;
      claimMode = "ready";
      claimOpen = true;
    }
  });

  function saveName() {
    const name = nameDraft.trim() || "Player";
    onProfileChange(updateProfile({ displayName: name }));
  }

  function cycleAvatar() {
    const idx = AVATARS.indexOf(profile.avatar as (typeof AVATARS)[number]);
    const next = AVATARS[(idx + 1) % AVATARS.length];
    onProfileChange(updateProfile({ avatar: next }));
  }

  function openDailyClaim() {
    claimMode = dailyReady ? "ready" : "already";
    claimOpen = true;
  }

  function confirmDailyClaim() {
    const result = claimDailyBankroll();
    onProfileChange(result.profile);
    if (result.ok) {
      claimAmount = result.amount;
      claimMode = "success";
    } else {
      claimMode = "already";
    }
  }
</script>

<div class="lobby flex h-full min-h-0 flex-col gap-5 overflow-auto p-6">
  <header>
    <h1 class="text-2xl font-semibold tracking-tight">Poker</h1>
    <p class="text-muted-foreground mt-1 text-sm">
      Entertainment Texas Hold'em — bots in-browser, or friends via peer-to-peer rooms.
    </p>
  </header>

  <section class="bg-muted/30 flex flex-wrap items-center gap-4 rounded-2xl border p-4">
    <button
      type="button"
      class="bg-background hover:ring-primary flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow ring-offset-2 hover:ring-2"
      onclick={cycleAvatar}
      aria-label="Change avatar"
    >
      {profile.avatar}
    </button>
    <div class="flex min-w-[12rem] flex-1 flex-col gap-2">
      <label class="text-muted-foreground text-xs" for="poker-name">Display name</label>
      <div class="flex gap-2">
        <Input id="poker-name" bind:value={nameDraft} onblur={saveName} />
        <Button variant="secondary" size="sm" onclick={saveName}>Save</Button>
      </div>
    </div>
    <div class="text-sm">
      <div class="text-muted-foreground text-xs">Bankroll</div>
      <div class="text-lg font-semibold tabular-nums">{profile.bankroll.toLocaleString()}</div>
      <div class="mt-1 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={dailyReady ? "default" : "secondary"}
          onclick={openDailyClaim}
          title={dailyReady ? `Claim ${DAILY_CLAIM_AMOUNT.toLocaleString()} chips` : "Already claimed today"}
        >
          {dailyReady
            ? `Daily claim +${DAILY_CLAIM_AMOUNT.toLocaleString()}`
            : "Claimed today"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={() => onProfileChange(topUpBankroll())}
        >
          Top up
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => onProfileChange(resetBankroll())}
        >
          Reset
        </Button>
      </div>
      {#if dailyReady}
        <p class="text-muted-foreground mt-1.5 text-xs">
          Free chips once per day (local time).
        </p>
      {/if}
    </div>
  </section>

  <DailyClaimDialog
    open={claimOpen}
    mode={claimMode}
    amount={claimAmount}
    bankroll={profile.bankroll}
    onOpenChange={(open) => (claimOpen = open)}
    onClaim={confirmDailyClaim}
  />

  {#if resumeAvailable && onResume}
    <section class="border-primary/40 bg-primary/5 rounded-2xl border p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold">Resume game</div>
          <p class="text-muted-foreground text-xs">
            {resumeHint ??
              "A table was in progress before reload. Continue where you left off."}
          </p>
        </div>
        <div class="flex gap-2">
          {#if onDiscardResume}
            <Button variant="ghost" size="sm" disabled={connecting} onclick={onDiscardResume}
              >Discard</Button
            >
          {/if}
          <Button size="sm" disabled={connecting} onclick={onResume}>Resume</Button>
        </div>
      </div>
    </section>
  {/if}

  <section class="grid gap-3 sm:grid-cols-2">
    <button
      type="button"
      class="hover:border-primary bg-card rounded-2xl border p-5 text-left transition"
      onclick={onSolo}
      disabled={connecting}
    >
      <div class="text-lg font-semibold">Play Against Bot</div>
      <p class="text-muted-foreground mt-1 text-sm">Solo table with bots auto-filled. No network.</p>
    </button>

    <button
      type="button"
      class="hover:border-primary bg-card rounded-2xl border p-5 text-left transition"
      onclick={onCreateRoom}
      disabled={connecting}
    >
      <div class="text-lg font-semibold">Casual — Create room</div>
      <p class="text-muted-foreground mt-1 text-sm">
        Host a peer-to-peer table and share the room code.
      </p>
    </button>
  </section>

  <section class="bg-card rounded-2xl border p-4">
    <div class="mb-2 text-sm font-medium">Join room</div>
    <div class="flex flex-wrap gap-2">
      <Input
        class="min-w-[14rem] flex-1"
        placeholder="Paste host room code"
        bind:value={joinCode}
        disabled={connecting}
      />
      <Button
        disabled={connecting || !joinCode.trim()}
        onclick={() => onJoinRoom(joinCode)}
      >
        {connecting ? "Connecting…" : "Join"}
      </Button>
    </div>
    {#if errorText}
      <p class="text-destructive mt-2 text-sm">{errorText}</p>
    {/if}
  </section>

  <section class="flex flex-wrap gap-2">
    <Button variant="outline" onclick={onHowTo}>How to play</Button>
    <Button variant="outline" onclick={onLeaderboard}>Leaderboard</Button>
  </section>
</div>
