<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import HowToPlay from "./components/HowToPlay.svelte";
  import Leaderboard from "./components/Leaderboard.svelte";
  import Lobby from "./components/Lobby.svelte";
  import TableView from "./components/TableView.svelte";
  import { PokerSession } from "./poker-session.svelte";
  import { hasResumableSession, loadSessionSnapshot } from "./store/session-persist";

  const session = new PokerSession();
  let resumeAvailable = $state(hasResumableSession());
  let resumeHint = $state<string | undefined>(undefined);

  function refreshResumeUi() {
    resumeAvailable = hasResumableSession();
    const snap = loadSessionSnapshot();
    resumeHint =
      snap?.mode === "guest" && snap.roomCode
        ? `Rejoin room ${snap.roomCode} (host must still be online)`
        : undefined;
  }

  onMount(() => {
    const onPageHide = () => session.destroy();
    window.addEventListener("pagehide", onPageHide);

    refreshResumeUi();
    // Solo/host only — never block on PeerJS during auto-resume.
    void session.tryResume({ auto: true }).finally(refreshResumeUi);

    return () => window.removeEventListener("pagehide", onPageHide);
  });

  onDestroy(() => session.destroy());

  const modeLabel = $derived(
    session.mode === "solo"
      ? "Play Against Bot"
      : session.mode === "host"
        ? "Host table"
        : "Guest table",
  );

  function onResumeClick() {
    const snap = loadSessionSnapshot();
    const network = snap?.mode === "guest";
    void session.tryResume({ network }).finally(refreshResumeUi);
  }
</script>

<div class="poker-app bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
  {#if session.resuming}
    <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div class="text-muted-foreground text-sm">Resuming game…</div>
      <Button variant="outline" size="sm" onclick={() => session.discardResume()}>Cancel</Button>
    </div>
  {:else if session.screen === "home"}
    <Lobby
      profile={session.profile}
      connecting={session.connecting}
      errorText={session.errorText}
      resumeAvailable={resumeAvailable}
      {resumeHint}
      onProfileChange={(p) => (session.profile = p)}
      onSolo={() => session.startSolo()}
      onCreateRoom={() => void session.createRoom()}
      onJoinRoom={(code) => void session.joinRoom(code)}
      onResume={onResumeClick}
      onDiscardResume={() => {
        session.discardResume();
        refreshResumeUi();
      }}
      onHowTo={() => session.openHowTo()}
      onLeaderboard={() => session.openLeaderboard()}
    />
  {:else if session.screen === "how-to"}
    <HowToPlay onBack={() => (session.screen = "home")} />
  {:else if session.screen === "leaderboard"}
    <Leaderboard profile={session.profile} onBack={() => (session.screen = "home")} />
  {:else if session.screen === "table" && session.tableView}
    <TableView
      table={session.tableView}
      mySeatIndex={session.mySeatIndex}
      raiseAmount={session.raiseAmount}
      roomCode={session.roomCode}
      statusText={session.statusText}
      {modeLabel}
      showFillBots={session.mode === "host" || session.mode === "solo"}
      onFillBots={() => session.fillBots(3)}
      onRaiseAmount={(n) => session.setRaiseAmount(n)}
      onAction={(req) => session.submitAction(req)}
      onSit={(i) => session.sit(i)}
      onLeaveSeat={() => session.leaveSeat()}
      onLeaveTable={() => {
        session.backHome();
        resumeAvailable = false;
      }}
    />
  {:else if session.screen === "table"}
    <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div class="text-muted-foreground text-sm">
        {session.connecting ? "Connecting…" : "Waiting for table state…"}
      </div>
      {#if session.errorText}
        <p class="text-destructive text-sm">{session.errorText}</p>
      {/if}
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={() => session.backHome()}>Lobby</Button>
        <Button variant="ghost" size="sm" onclick={() => session.discardResume()}>Discard save</Button>
      </div>
    </div>
  {/if}
</div>
