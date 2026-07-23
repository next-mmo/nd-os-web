import { createDeck, shuffleDeck } from "./cards";
import { evaluateBestHand } from "./hand-rank";
import type {
  ActionRequest,
  AllowedAction,
  Card,
  HandResult,
  SeatPlayer,
  SeatState,
  TableConfig,
  TableState,
  WireAction,
} from "./types";
import { DEFAULT_TABLE_CONFIG } from "./types";

function emptySeat(index: number): SeatState {
  return {
    index,
    player: null,
    status: "empty",
    holeCards: [],
    currentBet: 0,
    totalBet: 0,
    isWinner: false,
  };
}

function cloneState(state: TableState): TableState {
  return structuredClone(state);
}

/** Full engine snapshot for local resume after reload. */
export type PokerTableSnapshot = {
  state: TableState;
  deck: Card[];
  currentBet: number;
  minRaiseTo: number;
  lastAggressor: number;
  actedThisRound: number[];
};

export class PokerTable {
  private state: TableState;
  private deck: Card[] = [];
  private currentBet = 0;
  private minRaiseTo = 0;
  private lastAggressor = -1;
  private actedThisRound = new Set<number>();
  private rng: () => number;

  constructor(config: Partial<TableConfig> = {}, rng: () => number = Math.random) {
    const merged = { ...DEFAULT_TABLE_CONFIG, ...config };
    this.rng = rng;
    this.state = {
      config: merged,
      seats: Array.from({ length: merged.seatCount }, (_, i) => emptySeat(i)),
      stage: "waiting",
      board: [],
      pot: 0,
      sidePots: [],
      dealerIndex: 0,
      sbIndex: -1,
      bbIndex: -1,
      acting: null,
      handNumber: 0,
      lastResult: null,
      lastMessage: "Sit down to play",
      countdownEndsAt: null,
      version: 0,
    };
  }

  getState(): TableState {
    return cloneState(this.state);
  }

  exportSnapshot(): PokerTableSnapshot {
    return {
      state: cloneState(this.state),
      deck: structuredClone(this.deck),
      currentBet: this.currentBet,
      minRaiseTo: this.minRaiseTo,
      lastAggressor: this.lastAggressor,
      actedThisRound: [...this.actedThisRound],
    };
  }

  static fromSnapshot(snapshot: PokerTableSnapshot, rng: () => number = Math.random): PokerTable {
    const table = new PokerTable(snapshot.state.config, rng);
    table.state = cloneState(snapshot.state);
    table.deck = structuredClone(snapshot.deck);
    table.currentBet = snapshot.currentBet;
    table.minRaiseTo = snapshot.minRaiseTo;
    table.lastAggressor = snapshot.lastAggressor;
    table.actedThisRound = new Set(snapshot.actedThisRound);
    table.refreshTimersAfterResume();
    return table;
  }

  /** Give a short grace window if timers expired while the page was closed. */
  refreshTimersAfterResume(graceMs = 5_000): void {
    const now = Date.now();
    if (this.state.acting && this.state.acting.turnEndsAt <= now) {
      this.state.acting = { ...this.state.acting, turnEndsAt: now + graceMs };
    }
    if (
      this.state.stage === "countdown" &&
      this.state.countdownEndsAt !== null &&
      this.state.countdownEndsAt <= now
    ) {
      this.state.countdownEndsAt = now + Math.min(graceMs, this.state.config.countdownMs);
    }
  }

  /** After host reload, remote humans are gone — keep their stacks as bots. */
  convertRemoteHumansToBots(localPlayerId: string): void {
    for (const seat of this.state.seats) {
      if (!seat.player || seat.player.isBot) continue;
      if (seat.player.id === localPlayerId) {
        seat.player.peerId = undefined;
        continue;
      }
      seat.player = {
        ...seat.player,
        isBot: true,
        peerId: undefined,
        name: seat.player.name.replace(/\s*\(bot\)\s*$/, "") + " (bot)",
        avatar: "🤖",
      };
    }
    this.bump("Resumed — disconnected players are bots");
  }

  /**
   * Viewer-specific state: opponents' hole cards are cleared unless showdown
   * (active/all-in). UI shows face-down backs when `holeFaceDown` is true.
   */
  getViewFor(viewerSeatIndex: number | null): TableState & { holeFaceDown: boolean[] } {
    const view = this.getState() as TableState & { holeFaceDown: boolean[] };
    const revealShowdown = view.stage === "showdown";
    view.holeFaceDown = view.seats.map((seat) => {
      if (!seat.player || seat.holeCards.length === 0) return false;
      if (seat.index === viewerSeatIndex) return false;
      if (revealShowdown && (seat.status === "active" || seat.status === "all-in")) return false;
      return true;
    });
    for (let i = 0; i < view.seats.length; i++) {
      if (view.holeFaceDown[i]) view.seats[i].holeCards = [];
    }
    return view;
  }

  seatedCount(): number {
    return this.state.seats.filter((s) => s.player).length;
  }

  sit(seatIndex: number, player: SeatPlayer): void {
    this.assertSeat(seatIndex);
    if (this.state.seats[seatIndex].player) throw new Error("Seat taken");
    if (this.state.seats.some((s) => s.player?.id === player.id)) {
      throw new Error("Already seated");
    }
    this.state.seats[seatIndex].player = { ...player };
    this.state.seats[seatIndex].status = "seated";
    this.bump(`${player.name} sat down`);
    this.maybeStartCountdown();
  }

  stand(seatIndex: number): void {
    this.assertSeat(seatIndex);
    const seat = this.state.seats[seatIndex];
    if (!seat.player) return;
    const name = seat.player.name;
    if (this.state.acting?.seatIndex === seatIndex && this.isBettingStage()) {
      this.applyAction(seatIndex, { action: "fold" });
    }
    this.state.seats[seatIndex] = emptySeat(seatIndex);
    this.bump(`${name} left`);
    if (this.seatedCount() < 2 && this.state.stage !== "waiting") {
      this.resetToWaiting("Not enough players");
    }
  }

  fillBots(count = 3): void {
    const names = ["RiverBot", "BluffBot", "ChipBot", "AceBot", "PotBot"];
    let filled = 0;
    for (let i = 0; i < this.state.seats.length && filled < count; i++) {
      if (this.state.seats[i].player) continue;
      this.sit(i, {
        id: `bot-${i}-${Date.now()}`,
        name: names[filled % names.length],
        avatar: "🤖",
        chips: this.state.config.startingStack,
        isBot: true,
      });
      filled++;
    }
  }

  /** Called by session when countdown timer expires. */
  startHandFromCountdown(): void {
    if (this.state.stage !== "countdown") return;
    this.startHand();
  }

  applyAction(seatIndex: number, request: ActionRequest): void {
    if (!this.state.acting || this.state.acting.seatIndex !== seatIndex) {
      throw new Error("Not your turn");
    }
    const seat = this.state.seats[seatIndex];
    if (!seat.player) throw new Error("Empty seat");

    const info = this.computeActingInfo(seatIndex);
    const action = this.normalizeAction(request, info);

    if (action.action === "fold") {
      seat.status = "folded";
      this.bump(`${seat.player.name} folds`);
    } else if (action.action === "check") {
      if (info.callAmount > 0) throw new Error("Cannot check");
      this.bump(`${seat.player.name} checks`);
    } else if (action.action === "call") {
      const pay = Math.min(info.callAmount, seat.player.chips);
      this.commit(seatIndex, pay);
      this.bump(pay >= seat.player.chips + pay ? `${seat.player.name} calls all-in` : `${seat.player.name} calls ${pay}`);
      // fix message after commit depleted chips
      if (seat.status === "all-in") {
        this.state.lastMessage = `${seat.player.name} calls all-in (${pay})`;
      }
    } else if (action.action === "raise") {
      const add = action.amount ?? 0;
      if (!info.allowedActions.includes("raise") && !info.allowedActions.includes("all-in")) {
        throw new Error("Raise not allowed");
      }
      if (add < info.minRaise && add < seat.player.chips) {
        throw new Error("Raise too small");
      }
      if (add > info.maxRaise) throw new Error("Raise too large");
      this.commit(seatIndex, add);
      this.currentBet = seat.currentBet;
      this.minRaiseTo = this.currentBet + Math.max(this.state.config.bigBlind, add - info.callAmount);
      this.lastAggressor = seatIndex;
      this.actedThisRound = new Set([seatIndex]);
      this.bump(
        seat.status === "all-in"
          ? `${seat.player.name} all-in ${add}`
          : `${seat.player.name} raises ${add}`,
      );
    }

    this.actedThisRound.add(seatIndex);
    this.afterAction();
  }

  /** Tick turn timeout — auto check/fold. */
  onTurnTimeout(): void {
    if (!this.state.acting) return;
    const idx = this.state.acting.seatIndex;
    const info = this.state.acting;
    if (info.callAmount === 0 && info.allowedActions.includes("check")) {
      this.applyAction(idx, { action: "check" });
    } else {
      this.applyAction(idx, { action: "fold" });
    }
  }

  private normalizeAction(
    request: ActionRequest,
    info: ReturnType<PokerTable["computeActingInfo"]>,
  ): ActionRequest {
    const { action, amount } = request;
    if (action === "fold") return { action: "fold" };
    if (action === "check") {
      if (info.callAmount > 0) throw new Error("Must call or fold");
      return { action: "check" };
    }
    if (action === "call") return { action: "call" };
    if (action === "raise") {
      const seat = this.state.seats[info.seatIndex];
      const chips = seat.player!.chips;
      let add = amount ?? info.maxRaise;
      // All-in shorthand: if amount equals stack, treat as raise or call
      if (add >= chips && info.callAmount >= chips) {
        return { action: "call" };
      }
      if (add > info.maxRaise) add = info.maxRaise;
      if (add < info.minRaise && add < chips) {
        // short stack all-in raise
        if (add === chips) return { action: "raise", amount: add };
        throw new Error("Invalid raise");
      }
      return { action: "raise", amount: add };
    }
    throw new Error("Unknown action");
  }

  private maybeStartCountdown(): void {
    if (this.state.stage !== "waiting") return;
    if (this.seatedCount() < 2) return;
    this.state.stage = "countdown";
    this.state.countdownEndsAt = Date.now() + this.state.config.countdownMs;
    this.bump("Next hand starting…");
  }

  private startHand(): void {
    const seated = this.state.seats.filter((s) => s.player && s.player.chips > 0);
    if (seated.length < 2) {
      this.resetToWaiting("Need 2 players with chips");
      return;
    }

    this.state.handNumber += 1;
    this.state.lastResult = null;
    this.state.board = [];
    this.state.pot = 0;
    this.state.sidePots = [];
    this.state.countdownEndsAt = null;
    this.deck = shuffleDeck(createDeck(), this.rng);

    for (const seat of this.state.seats) {
      seat.holeCards = [];
      seat.currentBet = 0;
      seat.totalBet = 0;
      seat.isWinner = false;
      if (seat.player && seat.player.chips > 0) {
        seat.status = "active";
      } else if (seat.player) {
        seat.status = "seated";
      }
    }

    // Advance dealer among seated-with-chips
    const indexes = seated.map((s) => s.index);
    if (this.state.handNumber === 1) {
      this.state.dealerIndex = indexes[0];
    } else {
      this.state.dealerIndex = this.nextOccupied(this.state.dealerIndex, indexes);
    }

    if (indexes.length === 2) {
      // Heads-up: dealer is SB
      this.state.sbIndex = this.state.dealerIndex;
      this.state.bbIndex = this.nextOccupied(this.state.dealerIndex, indexes);
    } else {
      this.state.sbIndex = this.nextOccupied(this.state.dealerIndex, indexes);
      this.state.bbIndex = this.nextOccupied(this.state.sbIndex, indexes);
    }

    this.postBlind(this.state.sbIndex, this.state.config.smallBlind);
    this.postBlind(this.state.bbIndex, this.state.config.bigBlind);

    this.currentBet = this.state.config.bigBlind;
    this.minRaiseTo = this.state.config.bigBlind * 2;
    this.lastAggressor = this.state.bbIndex;
    this.actedThisRound = new Set();

    // Deal hole cards
    for (let r = 0; r < 2; r++) {
      for (const idx of this.orderFrom(this.state.dealerIndex + 1)) {
        const seat = this.state.seats[idx];
        if (seat.status === "active" || seat.status === "all-in") {
          seat.holeCards.push(this.deck.pop()!);
        }
      }
    }

    this.state.stage = "preflop";
    const first = indexes.length === 2
      ? this.state.dealerIndex // SB/dealer acts first HU preflop
      : this.nextActive(this.state.bbIndex);
    this.setActing(first);
    this.bump(`Hand #${this.state.handNumber}`);
  }

  private postBlind(seatIndex: number, amount: number): void {
    const seat = this.state.seats[seatIndex];
    if (!seat.player) return;
    const pay = Math.min(amount, seat.player.chips);
    this.commit(seatIndex, pay);
  }

  private commit(seatIndex: number, amount: number): void {
    const seat = this.state.seats[seatIndex];
    if (!seat.player || amount <= 0) return;
    const pay = Math.min(amount, seat.player.chips);
    seat.player.chips -= pay;
    seat.currentBet += pay;
    seat.totalBet += pay;
    this.state.pot += pay;
    if (seat.player.chips === 0) seat.status = "all-in";
  }

  private afterAction(): void {
    const contenders = this.state.seats.filter(
      (s) => s.status === "active" || s.status === "all-in",
    );
    const active = this.state.seats.filter((s) => s.status === "active");

    if (contenders.length === 1) {
      this.awardFoldWin(contenders[0].index);
      return;
    }

    if (this.bettingRoundComplete()) {
      this.advanceStreet();
      return;
    }

    // Next actor
    let next = this.nextActive(this.state.acting!.seatIndex);
    // Skip if only all-ins left facing each other with no one to act
    if (active.length === 0) {
      this.advanceStreet();
      return;
    }
    this.setActing(next);
  }

  private bettingRoundComplete(): boolean {
    const active = this.state.seats.filter((s) => s.status === "active");
    if (active.length === 0) return true;
    for (const seat of active) {
      if (seat.currentBet < this.currentBet) return false;
      if (!this.actedThisRound.has(seat.index) && seat.index !== this.lastAggressor) {
        // BB option preflop: BB has acted if they matched and were given chance
        // Simpler: everyone active must have acted at least once after last aggression
      }
      if (!this.actedThisRound.has(seat.index)) return false;
    }
    return active.every((s) => s.currentBet === this.currentBet || s.status === "all-in");
  }

  private advanceStreet(): void {
    // Reset round bets
    for (const seat of this.state.seats) seat.currentBet = 0;
    this.currentBet = 0;
    this.minRaiseTo = this.state.config.bigBlind;
    this.actedThisRound = new Set();
    this.lastAggressor = -1;

    const activeOrAllIn = this.state.seats.filter(
      (s) => s.status === "active" || s.status === "all-in",
    );
    if (activeOrAllIn.length <= 1) {
      if (activeOrAllIn.length === 1) this.awardFoldWin(activeOrAllIn[0].index);
      return;
    }

    const onlyAllIn = this.state.seats.every(
      (s) => s.status !== "active" || s.player === null,
    );
    // if no active players left, run out board
    const canBet = this.state.seats.some((s) => s.status === "active");

    if (this.state.stage === "preflop") {
      this.dealBoard(3);
      this.state.stage = "flop";
    } else if (this.state.stage === "flop") {
      this.dealBoard(1);
      this.state.stage = "turn";
    } else if (this.state.stage === "turn") {
      this.dealBoard(1);
      this.state.stage = "river";
    } else if (this.state.stage === "river") {
      this.showdown();
      return;
    }

    if (!canBet || onlyAllIn) {
      // Run out remaining streets
      while (this.state.board.length < 5) {
        this.dealBoard(this.state.board.length === 0 ? 3 : 1);
      }
      this.state.stage = "river";
      this.showdown();
      return;
    }

    const first = this.nextActive(this.state.dealerIndex);
    this.setActing(first);
    this.bump(this.state.stage.charAt(0).toUpperCase() + this.state.stage.slice(1));
  }

  private dealBoard(n: number): void {
    this.deck.pop(); // burn
    for (let i = 0; i < n; i++) this.state.board.push(this.deck.pop()!);
  }

  private showdown(): void {
    this.state.stage = "showdown";
    this.state.acting = null;
    this.buildSidePots();

    const winners: HandResult["winners"] = [];
    for (const pot of this.state.sidePots.length ? this.state.sidePots : [{ amount: this.state.pot, eligibleSeatIndexes: this.state.seats.filter((s) => s.status === "active" || s.status === "all-in").map((s) => s.index) }]) {
      let bestScore: number[] | null = null;
      const contenders: { seatIndex: number; name: string; score: number[] }[] = [];
      for (const idx of pot.eligibleSeatIndexes) {
        const seat = this.state.seats[idx];
        if (!seat.player || (seat.status !== "active" && seat.status !== "all-in")) continue;
        const ranked = evaluateBestHand([...seat.holeCards, ...this.state.board]);
        contenders.push({ seatIndex: idx, name: ranked.name, score: ranked.score });
        if (!bestScore || this.cmpScore(ranked.score, bestScore) > 0) bestScore = ranked.score;
      }
      const potWinners = contenders.filter((c) => this.cmpScore(c.score, bestScore!) === 0);
      const share = Math.floor(pot.amount / potWinners.length);
      let remainder = pot.amount - share * potWinners.length;
      for (const w of potWinners) {
        const amount = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        const seat = this.state.seats[w.seatIndex];
        seat.player!.chips += amount;
        seat.isWinner = true;
        winners.push({
          seatIndex: w.seatIndex,
          amount,
          handName: w.name,
          name: seat.player!.name,
          avatar: seat.player!.avatar,
          holeCards: [...seat.holeCards],
        });
      }
    }

    const potWon = winners.reduce((s, w) => s + w.amount, 0);
    this.state.lastResult = { kind: "showdown", winners, board: [...this.state.board], potWon };
    this.state.pot = 0;
    this.state.sidePots = [];
    const names = winners.map((w) => w.name).join(", ");
    this.bump(`Showdown — ${names} win`);
    this.finishHand(4_500);
  }

  private awardFoldWin(seatIndex: number): void {
    const seat = this.state.seats[seatIndex];
    if (!seat.player) return;
    const potWon = this.state.pot;
    seat.player.chips += potWon;
    seat.isWinner = true;
    this.state.lastResult = {
      kind: "fold",
      winners: [
        {
          seatIndex,
          amount: potWon,
          handName: "Fold win",
          name: seat.player.name,
          avatar: seat.player.avatar,
          holeCards: [...seat.holeCards],
        },
      ],
      board: [...this.state.board],
      potWon,
    };
    this.bump(`${seat.player.name} wins ${potWon}`);
    this.state.pot = 0;
    this.state.acting = null;
    this.finishHand(3_800);
  }

  private finishHand(countdownOverrideMs?: number): void {
    for (const seat of this.state.seats) {
      if (seat.player) seat.status = "seated";
      seat.currentBet = 0;
      seat.totalBet = 0;
      // Keep hole cards briefly for UI; cleared on next hand
    }
    this.state.stage = "waiting";
    this.state.acting = null;
    this.bump(this.state.lastMessage);
    // Auto countdown for next hand (longer after showdown so popup can play)
    if (this.seatedCount() >= 2) {
      this.state.stage = "countdown";
      const ms = countdownOverrideMs ?? this.state.config.countdownMs;
      this.state.countdownEndsAt = Date.now() + ms;
    }
  }

  private buildSidePots(): void {
    const contributors = this.state.seats
      .filter((s) => s.totalBet > 0 && (s.status === "active" || s.status === "all-in" || s.status === "folded"))
      .map((s) => ({ index: s.index, total: s.totalBet, live: s.status === "active" || s.status === "all-in" }));

    if (!contributors.length) {
      this.state.sidePots = [];
      return;
    }

    const levels = [...new Set(contributors.map((c) => c.total))].sort((a, b) => a - b);
    const pots: { amount: number; eligibleSeatIndexes: number[] }[] = [];
    let prev = 0;
    for (const level of levels) {
      const layer = level - prev;
      let amount = 0;
      const eligible: number[] = [];
      for (const c of contributors) {
        if (c.total >= level) {
          amount += layer;
          if (c.live) eligible.push(c.index);
        } else if (c.total > prev) {
          amount += c.total - prev;
        }
      }
      // recount properly
      amount = 0;
      for (const c of contributors) {
        const contrib = Math.min(c.total, level) - prev;
        if (contrib > 0) amount += contrib;
      }
      if (amount > 0 && eligible.length) {
        pots.push({ amount, eligibleSeatIndexes: eligible });
      }
      prev = level;
    }
    this.state.sidePots = pots;
    this.state.pot = pots.reduce((s, p) => s + p.amount, 0);
  }

  private setActing(seatIndex: number): void {
    const info = this.computeActingInfo(seatIndex);
    this.state.acting = {
      ...info,
      turnEndsAt: Date.now() + this.state.config.turnMs,
    };
  }

  computeActingInfo(seatIndex: number): {
    seatIndex: number;
    callAmount: number;
    minRaise: number;
    maxRaise: number;
    allowedActions: AllowedAction[];
  } {
    const seat = this.state.seats[seatIndex];
    const chips = seat.player?.chips ?? 0;
    const callAmount = Math.max(0, this.currentBet - seat.currentBet);
    const remainingCap =
      this.state.config.maxInvestmentPerHand > 0
        ? Math.max(0, this.state.config.maxInvestmentPerHand - seat.totalBet)
        : Infinity;

    const fundedOpponent = this.state.seats.some(
      (s) =>
        s.index !== seatIndex &&
        s.status === "active" &&
        (s.player?.chips ?? 0) > 0,
    );

    const allowedActions: AllowedAction[] = ["fold"];
    if (callAmount === 0) allowedActions.push("check");
    else allowedActions.push("call");

    // min raise = chips added this action to raise to currentBet + bigBlind (or last raise size)
    const raiseToMin = Math.max(this.minRaiseTo, this.currentBet + this.state.config.bigBlind);
    let minRaise = raiseToMin - seat.currentBet; // chips to add
    if (minRaise < callAmount) minRaise = callAmount + this.state.config.bigBlind;

    let maxRaise = Math.min(chips, remainingCap === Infinity ? chips : remainingCap);
    // Cannot raise if no funded opponent
    if (fundedOpponent && maxRaise > callAmount) {
      if (minRaise > maxRaise) {
        // can only all-in short
        if (chips > callAmount) {
          allowedActions.push("all-in");
          minRaise = chips;
          maxRaise = chips;
        }
      } else {
        allowedActions.push("raise");
        if (maxRaise === chips) allowedActions.push("all-in");
      }
    } else if (callAmount > 0 && callAmount >= chips) {
      allowedActions.push("all-in");
      maxRaise = chips;
      minRaise = chips;
    }

    // Cap minRaise
    if (minRaise > maxRaise) minRaise = maxRaise;

    return { seatIndex, callAmount: Math.min(callAmount, chips), minRaise, maxRaise, allowedActions };
  }

  private nextOccupied(from: number, indexes: number[]): number {
    const sorted = [...indexes].sort((a, b) => a - b);
    for (const i of sorted) if (i > from) return i;
    return sorted[0];
  }

  private nextActive(from: number): number {
    const n = this.state.seats.length;
    for (let step = 1; step <= n; step++) {
      const idx = (from + step) % n;
      if (this.state.seats[idx].status === "active") return idx;
    }
    return from;
  }

  private orderFrom(start: number): number[] {
    const n = this.state.seats.length;
    return Array.from({ length: n }, (_, i) => (start + i) % n);
  }

  private isBettingStage(): boolean {
    return ["preflop", "flop", "turn", "river"].includes(this.state.stage);
  }

  private resetToWaiting(message: string): void {
    this.state.stage = "waiting";
    this.state.acting = null;
    this.state.countdownEndsAt = null;
    this.state.board = [];
    this.state.pot = 0;
    for (const seat of this.state.seats) {
      if (seat.player) seat.status = "seated";
      seat.holeCards = [];
      seat.currentBet = 0;
      seat.totalBet = 0;
    }
    this.bump(message);
  }

  private assertSeat(i: number): void {
    if (i < 0 || i >= this.state.seats.length) throw new Error("Invalid seat");
  }

  private bump(message: string): void {
    this.state.lastMessage = message;
    this.state.version += 1;
  }

  private cmpScore(a: number[], b: number[]): number {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d;
    }
    return 0;
  }
}

/** Helper used by UI: whether seat has face-down hole cards. */
export function seatHasHiddenHole(seat: SeatState, viewerSeat: number | null, stage: string): boolean {
  if (!seat.player) return false;
  if (seat.index === viewerSeat) return false;
  if (stage === "showdown" && (seat.status === "active" || seat.status === "all-in")) return false;
  return seat.status === "active" || seat.status === "all-in" || seat.status === "folded";
}

export function isLegalWireAction(
  allowed: AllowedAction[],
  action: WireAction,
  amount: number | undefined,
  info: { callAmount: number; minRaise: number; maxRaise: number; chips: number },
): boolean {
  if (action === "fold") return allowed.includes("fold");
  if (action === "check") return allowed.includes("check");
  if (action === "call") return allowed.includes("call") || allowed.includes("all-in");
  if (action === "raise") {
    if (!allowed.includes("raise") && !allowed.includes("all-in")) return false;
    const add = amount ?? 0;
    if (add > info.maxRaise) return false;
    if (add < info.minRaise && add < info.chips) return false;
    return true;
  }
  return false;
}
