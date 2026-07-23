import { chooseBotAction, PokerTable, type ActionRequest, type TableState } from "./engine";
import { P2pSession } from "./net/p2p-session";
import type { HostMessage, NetMessage } from "./net/protocol";
import { loadProfile, recordHandResult, updateProfile, type PokerProfile } from "./store/profile";
import {
  canAutoResumeSession,
  clearSessionSnapshot,
  isValidTableSnapshot,
  loadSessionSnapshot,
  saveSessionSnapshot,
  type PlayMode,
} from "./store/session-persist";

export type LobbyScreen = "home" | "how-to" | "leaderboard" | "table";
export type { PlayMode };

type ViewState = TableState & { holeFaceDown?: boolean[] };

function playerId(): string {
  const key = "nd-os-web:poker-player-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export class PokerSession {
  screen = $state<LobbyScreen>("home");
  mode = $state<PlayMode>("solo");
  profile = $state<PokerProfile>(loadProfile());
  tableView = $state<ViewState | null>(null);
  mySeatIndex = $state<number | null>(null);
  roomCode = $state<string | null>(null);
  statusText = $state("");
  errorText = $state("");
  connecting = $state(false);
  raiseAmount = $state(0);

  private table: PokerTable | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private p2p: P2pSession | null = null;
  private guestByPeer = new Map<string, { playerId: string; name: string; avatar: string; chips: number; seatIndex: number | null }>();
  private handStartChips = 0;
  private recordedHandVersion = -1;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** When true, leave/destroy should not wipe the saved session (reload path). */
  private keepSnapshotOnTeardown = false;
  readonly localPlayerId = playerId();
  resuming = $state(false);

  refreshProfile(): void {
    this.profile = loadProfile();
  }

  /**
   * Restore an in-progress game after page reload.
   * Solo/host restore the table immediately (no network wait).
   * Guest rejoin is opt-in via `{ network: true }` so auto-resume never hangs.
   */
  async tryResume(opts?: { network?: boolean; auto?: boolean }): Promise<boolean> {
    const snap = loadSessionSnapshot();
    if (!snap) return false;
    if (opts?.auto && !canAutoResumeSession(snap)) return false;

    this.resuming = true;
    this.errorText = "";
    try {
      if (snap.mode === "solo" || snap.mode === "host") {
        if (!isValidTableSnapshot(snap.table)) {
          clearSessionSnapshot();
          return false;
        }
        return this.resumeLocalTable(snap);
      }

      // Guest: only when explicitly requested (Resume button).
      if (!opts?.network) return false;
      if (!snap.roomCode) {
        clearSessionSnapshot();
        return false;
      }
      this.handStartChips = snap.handStartChips;
      this.recordedHandVersion = snap.recordedHandVersion;
      await this.joinRoom(snap.roomCode, { fromResume: true });
      if (this.screen === "table") {
        this.statusText = `Rejoined ${snap.roomCode}`;
        return true;
      }
      // Keep snapshot so user can retry; surface error from joinRoom.
      return false;
    } catch (e) {
      this.errorText = e instanceof Error ? e.message : "Resume failed";
      // Corrupt local table — drop it. Guest/network errors keep snapshot for retry.
      if (snap.mode === "solo" || (snap.mode === "host" && !this.table)) {
        clearSessionSnapshot();
      }
      this.screen = "home";
      return false;
    } finally {
      this.resuming = false;
      this.connecting = false;
    }
  }

  /** Discard saved session and return to lobby (escape hatch when resume hangs). */
  discardResume(): void {
    this.resuming = false;
    this.connecting = false;
    this.keepSnapshotOnTeardown = false;
    clearSessionSnapshot();
    this.leaveTable({ skipCashOut: true });
    this.screen = "home";
    this.errorText = "";
  }

  private resumeLocalTable(snap: NonNullable<ReturnType<typeof loadSessionSnapshot>>): boolean {
    try {
      this.leaveTable({ preserveSnapshot: true, skipCashOut: true });
      this.mode = snap.mode === "host" ? "host" : "solo";
      this.table = PokerTable.fromSnapshot(snap.table!);
      if (this.mode === "host") {
        this.table.convertRemoteHumansToBots(this.localPlayerId);
      }
      this.mySeatIndex = snap.mySeatIndex;
      this.handStartChips = snap.handStartChips;
      this.recordedHandVersion = snap.recordedHandVersion;
      this.roomCode = null;
      this.guestByPeer.clear();
      this.screen = "table";
      this.statusText =
        this.mode === "host"
          ? "Resumed table (reconnecting room…)"
          : snap.statusText || "Solo vs bots (resumed)";
      this.syncView();
      this.startTicker();
      this.schedulePersist();
      // Unblock UI before any PeerJS work.
      this.resuming = false;
      if (this.mode === "host") {
        void this.rehostInBackground();
      }
      return true;
    } catch (e) {
      clearSessionSnapshot();
      this.table = null;
      this.tableView = null;
      this.screen = "home";
      this.errorText = e instanceof Error ? e.message : "Saved game was unreadable";
      return false;
    }
  }

  private async rehostInBackground(): Promise<void> {
    if (this.mode !== "host" || !this.table) return;
    this.connecting = true;
    try {
      this.p2p?.destroy();
      this.p2p = new P2pSession({
        onMessage: (peerId, msg) => this.onHostMessage(peerId, msg),
        onDisconnect: (peerId) => this.onPeerLeave(peerId),
        onError: (m) => {
          this.errorText = m;
        },
      });
      const id = await this.p2p.host();
      if (this.screen !== "table" || this.mode !== "host") {
        this.p2p.destroy();
        this.p2p = null;
        return;
      }
      this.roomCode = id;
      this.statusText = `Room ${id} (resumed — share new code)`;
      this.broadcastState();
      this.schedulePersist();
    } catch (e) {
      this.p2p?.destroy();
      this.p2p = null;
      this.roomCode = null;
      this.statusText = "Resumed offline — room unavailable (bots only)";
      this.errorText = e instanceof Error ? e.message : "Could not recreate room";
    } finally {
      this.connecting = false;
    }
  }

  openHowTo(): void {
    this.screen = "how-to";
  }

  openLeaderboard(): void {
    this.refreshProfile();
    this.screen = "leaderboard";
  }

  backHome(): void {
    this.keepSnapshotOnTeardown = false;
    this.leaveTable();
    this.screen = "home";
  }

  startSolo(): void {
    this.keepSnapshotOnTeardown = false;
    this.leaveTable();
    this.mode = "solo";
    this.table = new PokerTable();
    this.screen = "table";
    this.statusText = "Solo vs bots";
    this.sitLocal(0);
    this.table.fillBots(3);
    this.syncView();
    this.startTicker();
    this.schedulePersist();
  }

  async createRoom(): Promise<void> {
    this.keepSnapshotOnTeardown = false;
    this.leaveTable();
    this.mode = "host";
    this.connecting = true;
    this.errorText = "";
    try {
      this.table = new PokerTable();
      this.p2p = new P2pSession({
        onMessage: (peerId, msg) => this.onHostMessage(peerId, msg),
        onDisconnect: (peerId) => this.onPeerLeave(peerId),
        onError: (m) => {
          this.errorText = m;
        },
      });
      const id = await this.p2p.host();
      this.roomCode = id;
      this.screen = "table";
      this.statusText = `Room ${id}`;
      this.sitLocal(0);
      this.syncView();
      this.broadcastState();
      this.startTicker();
      this.schedulePersist();
    } catch (e) {
      this.errorText = e instanceof Error ? e.message : "Failed to create room";
      this.leaveTable();
    } finally {
      this.connecting = false;
    }
  }

  async joinRoom(code: string, opts?: { fromResume?: boolean }): Promise<void> {
    const hostId = code.trim();
    if (!hostId) {
      this.errorText = "Enter a room code";
      return;
    }
    this.leaveTable({
      preserveSnapshot: Boolean(opts?.fromResume),
      skipCashOut: Boolean(opts?.fromResume),
    });
    this.mode = "guest";
    this.connecting = true;
    this.errorText = "";
    try {
      this.p2p = new P2pSession({
        onMessage: (_peerId, msg) => this.onGuestMessage(msg),
        onError: (m) => {
          this.errorText = m;
        },
        onDisconnect: () => {
          this.errorText = "Disconnected from host";
          this.backHome();
        },
      });
      await this.p2p.join(hostId);
      this.roomCode = hostId;
      this.screen = "table";
      this.statusText = `Joined ${hostId}`;
      this.p2p.sendToHost({
        type: "hello",
        playerId: this.localPlayerId,
        name: this.profile.displayName,
        avatar: this.profile.avatar,
        chips: Math.min(this.profile.bankroll, 10_000),
      });
      this.schedulePersist();
    } catch (e) {
      this.errorText = e instanceof Error ? e.message : "Failed to join";
      this.p2p?.destroy();
      this.p2p = null;
      this.screen = "home";
      if (!opts?.fromResume) {
        this.leaveTable();
      }
    } finally {
      this.connecting = false;
    }
  }

  sit(seatIndex: number): void {
    if (this.mode === "guest") {
      this.p2p?.sendToHost({ type: "sit", seatIndex });
      return;
    }
    if (!this.table) return;
    if (this.mySeatIndex !== null) return;
    this.sitLocal(seatIndex);
    this.syncView();
    this.broadcastState();
  }

  leaveSeat(): void {
    this.cashOutLocalSeat();
    if (this.mode === "guest") {
      this.p2p?.sendToHost({ type: "stand" });
      this.mySeatIndex = null;
      this.refreshProfile();
      return;
    }
    if (this.table && this.mySeatIndex !== null) {
      this.table.stand(this.mySeatIndex);
      this.mySeatIndex = null;
      this.syncView();
      this.broadcastState();
      this.refreshProfile();
    }
  }

  fillBots(count = 3): void {
    if (!this.table || this.mode === "guest") return;
    this.table.fillBots(count);
    this.syncView();
    this.broadcastState();
  }

  leaveTable(opts?: { preserveSnapshot?: boolean; skipCashOut?: boolean }): void {
    this.stopTicker();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!opts?.skipCashOut) this.cashOutLocalSeat();
    if (this.mode === "guest" && this.mySeatIndex !== null && !opts?.skipCashOut) {
      this.p2p?.sendToHost({ type: "stand" });
    }
    if (this.table && this.mySeatIndex !== null && this.mode !== "host" && this.mode !== "solo") {
      /* guest already stood via net */
    } else if (this.table && this.mySeatIndex !== null && !opts?.skipCashOut) {
      try {
        this.table.stand(this.mySeatIndex);
      } catch {
        /* ignore */
      }
    }
    this.p2p?.destroy();
    this.p2p = null;
    this.table = null;
    this.tableView = null;
    this.mySeatIndex = null;
    this.roomCode = null;
    this.guestByPeer.clear();
    this.raiseAmount = 0;
    if (!opts?.preserveSnapshot && !this.keepSnapshotOnTeardown) {
      clearSessionSnapshot();
    }
    this.refreshProfile();
  }

  private cashOutLocalSeat(): void {
    let chips: number | null = null;
    if (this.mode === "guest") {
      if (this.tableView && this.mySeatIndex !== null) {
        chips = this.tableView.seats[this.mySeatIndex]?.player?.chips ?? null;
      }
    } else if (this.table && this.mySeatIndex !== null) {
      chips = this.table.getState().seats[this.mySeatIndex]?.player?.chips ?? null;
    }
    if (chips === null) return;
    const delta = chips - this.handStartChips;
    if (delta !== 0) {
      this.profile = updateProfile({ bankroll: Math.max(0, this.profile.bankroll + delta) });
    }
    this.handStartChips = chips;
  }

  submitAction(request: ActionRequest): void {
    if (this.mode === "guest") {
      this.p2p?.sendToHost({ type: "action", request });
      return;
    }
    if (!this.table || this.mySeatIndex === null) return;
    try {
      this.table.applyAction(this.mySeatIndex, request);
      this.syncView();
      this.broadcastState();
    } catch (e) {
      this.errorText = e instanceof Error ? e.message : "Action failed";
    }
  }

  setRaiseAmount(n: number): void {
    this.raiseAmount = n;
  }

  /** Persist then tear down without cashing out — used on app unmount / reload. */
  destroy(): void {
    this.persistNow();
    this.keepSnapshotOnTeardown = true;
    this.stopTicker();
    this.p2p?.destroy();
    this.p2p = null;
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), 200);
  }

  private persistNow(): void {
    if (this.screen !== "table") return;
    if (this.mode === "guest") {
      if (!this.roomCode) return;
      saveSessionSnapshot({
        v: 1,
        mode: "guest",
        mySeatIndex: this.mySeatIndex,
        roomCode: this.roomCode,
        handStartChips: this.handStartChips,
        recordedHandVersion: this.recordedHandVersion,
        statusText: this.statusText,
        table: null,
        savedAt: Date.now(),
      });
      return;
    }
    if (!this.table) return;
    saveSessionSnapshot({
      v: 1,
      mode: this.mode,
      mySeatIndex: this.mySeatIndex,
      roomCode: this.roomCode,
      handStartChips: this.handStartChips,
      recordedHandVersion: this.recordedHandVersion,
      statusText: this.statusText,
      table: this.table.exportSnapshot(),
      savedAt: Date.now(),
    });
  }

  private sitLocal(seatIndex: number): void {
    if (!this.table) return;
    this.refreshProfile();
    const buyIn = Math.min(this.profile.bankroll, 10_000);
    this.table.sit(seatIndex, {
      id: this.localPlayerId,
      name: this.profile.displayName,
      avatar: this.profile.avatar,
      chips: buyIn,
      isBot: false,
    });
    this.mySeatIndex = seatIndex;
    this.handStartChips = buyIn;
  }

  private startTicker(): void {
    this.stopTicker();
    this.tickTimer = setInterval(() => this.tick(), 250);
  }

  private stopTicker(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private tick(): void {
    if (!this.table || this.mode === "guest") return;
    const state = this.table.getState();

    if (state.stage === "countdown" && state.countdownEndsAt && Date.now() >= state.countdownEndsAt) {
      this.table.startHandFromCountdown();
      this.noteHandStart();
      this.syncView();
      this.broadcastState();
      return;
    }

    if (state.acting && Date.now() >= state.acting.turnEndsAt) {
      try {
        this.table.onTurnTimeout();
      } catch {
        /* ignore */
      }
      this.syncView();
      this.broadcastState();
      return;
    }

    if (state.acting) {
      const seat = state.seats[state.acting.seatIndex];
      if (seat.player?.isBot) {
        // Small delay feel — act when ~1.2s left into turn or immediately if turn just started long enough
        const elapsed = state.config.turnMs - (state.acting.turnEndsAt - Date.now());
        if (elapsed > 800) {
          try {
            const action = chooseBotAction(state, state.acting.seatIndex);
            this.table.applyAction(state.acting.seatIndex, action);
            this.syncView();
            this.broadcastState();
          } catch {
            try {
              this.table.applyAction(state.acting.seatIndex, { action: "fold" });
              this.syncView();
              this.broadcastState();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }

    this.maybeRecordStats(state);
    // Keep timer UI fresh
    if (state.acting || state.stage === "countdown") this.syncView();
  }

  private noteHandStart(): void {
    if (this.mySeatIndex === null || !this.table) return;
    const seat = this.table.getState().seats[this.mySeatIndex];
    this.handStartChips = seat.player?.chips ?? 0;
    this.recordedHandVersion = -1;
  }

  private maybeRecordStats(state: TableState): void {
    if (this.mySeatIndex === null) return;
    if (!state.lastResult) return;
    if (state.version === this.recordedHandVersion) return;
    if (state.stage !== "waiting" && state.stage !== "countdown") return;

    const won = state.lastResult.winners.some((w) => w.seatIndex === this.mySeatIndex);
    const chips = state.seats[this.mySeatIndex]?.player?.chips ?? 0;
    const delta = chips - this.handStartChips;
    this.profile = recordHandResult(won, delta);
    this.recordedHandVersion = state.version;
    this.handStartChips = chips;
  }

  private syncView(): void {
    if (!this.table) return;
    this.tableView = this.table.getViewFor(this.mySeatIndex);
    const acting = this.tableView.acting;
    if (acting && acting.seatIndex === this.mySeatIndex) {
      if (this.raiseAmount < acting.minRaise || this.raiseAmount > acting.maxRaise) {
        this.raiseAmount = acting.minRaise;
      }
    }
    this.schedulePersist();
  }

  private broadcastState(): void {
    if (!this.p2p || this.mode !== "host" || !this.table) return;
    for (const [peerId, guest] of this.guestByPeer) {
      const view = this.table.getViewFor(guest.seatIndex);
      const msg: HostMessage = {
        type: "state",
        viewerSeatIndex: guest.seatIndex,
        state: view,
      };
      this.p2p.send(peerId, msg);
    }
  }

  private onHostMessage(peerId: string, message: NetMessage): void {
    if (!this.table || !this.p2p) return;
    if (message.type === "hello") {
      this.guestByPeer.set(peerId, {
        playerId: message.playerId,
        name: message.name,
        avatar: message.avatar,
        chips: message.chips,
        seatIndex: null,
      });
      this.p2p.send(peerId, {
        type: "welcome",
        roomCode: this.roomCode ?? "",
        yourPlayerId: message.playerId,
      });
      this.broadcastState();
      return;
    }

    const guest = this.guestByPeer.get(peerId);
    if (!guest) return;

    if (message.type === "sit") {
      try {
        if (guest.seatIndex !== null) return;
        this.table.sit(message.seatIndex, {
          id: guest.playerId,
          name: guest.name,
          avatar: guest.avatar,
          chips: guest.chips,
          isBot: false,
          peerId,
        });
        guest.seatIndex = message.seatIndex;
        this.syncView();
        this.broadcastState();
      } catch (e) {
        this.p2p.send(peerId, {
          type: "error",
          message: e instanceof Error ? e.message : "Sit failed",
        });
      }
      return;
    }

    if (message.type === "stand") {
      if (guest.seatIndex !== null) {
        this.table.stand(guest.seatIndex);
        guest.seatIndex = null;
        this.syncView();
        this.broadcastState();
      }
      return;
    }

    if (message.type === "action") {
      if (guest.seatIndex === null) return;
      try {
        this.table.applyAction(guest.seatIndex, message.request);
        this.syncView();
        this.broadcastState();
      } catch (e) {
        this.p2p.send(peerId, {
          type: "error",
          message: e instanceof Error ? e.message : "Action failed",
        });
      }
    }
  }

  private onGuestMessage(message: NetMessage): void {
    if (message.type === "welcome") {
      this.statusText = `Joined ${message.roomCode}`;
      return;
    }
    if (message.type === "state") {
      const prevSeat = this.mySeatIndex;
      this.tableView = message.state;
      this.mySeatIndex = message.viewerSeatIndex;
      if (prevSeat === null && message.viewerSeatIndex !== null) {
        const chips = message.state.seats[message.viewerSeatIndex]?.player?.chips ?? 0;
        this.handStartChips = chips;
        this.recordedHandVersion = -1;
      }
      const acting = message.state.acting;
      if (acting && acting.seatIndex === this.mySeatIndex) {
        if (this.raiseAmount < acting.minRaise || this.raiseAmount > acting.maxRaise) {
          this.raiseAmount = acting.minRaise;
        }
      }
      this.maybeRecordStats(message.state);
      this.schedulePersist();
      return;
    }
    if (message.type === "error") {
      this.errorText = message.message;
    }
  }

  private onPeerLeave(peerId: string): void {
    const guest = this.guestByPeer.get(peerId);
    if (guest?.seatIndex != null && this.table) {
      try {
        this.table.stand(guest.seatIndex);
      } catch {
        /* ignore */
      }
    }
    this.guestByPeer.delete(peerId);
    this.syncView();
    this.broadcastState();
  }
}
