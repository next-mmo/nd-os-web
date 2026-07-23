import { describe, expect, it } from "vitest";
import { PokerTable } from "./table";
import type { SeatPlayer } from "./types";

function player(id: string, chips = 10_000, isBot = false): SeatPlayer {
  return { id, name: id, avatar: "♠", chips, isBot };
}

function seededRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("PokerTable", () => {
  it("starts a hand after countdown when 2+ seated", () => {
    const table = new PokerTable({ countdownMs: 1 }, seededRng(42));
    table.sit(0, player("a"));
    table.sit(1, player("b"));
    expect(table.getState().stage).toBe("countdown");
    table.startHandFromCountdown();
    const state = table.getState();
    expect(state.stage).toBe("preflop");
    expect(state.seats[0].holeCards.length).toBe(2);
    expect(state.seats[1].holeCards.length).toBe(2);
    expect(state.acting).not.toBeNull();
  });

  it("hides opponent hole cards in viewer state", () => {
    const table = new PokerTable({ countdownMs: 1 }, seededRng(7));
    table.sit(0, player("a"));
    table.sit(1, player("b"));
    table.startHandFromCountdown();
    const view = table.getViewFor(0);
    expect(view.seats[0].holeCards.length).toBe(2);
    expect(view.seats[1].holeCards.length).toBe(0);
    expect(view.holeFaceDown[1]).toBe(true);
  });

  it("free action offers check and raise", () => {
    const table = new PokerTable({ countdownMs: 1, bigBlind: 100, smallBlind: 50 }, seededRng(3));
    table.sit(0, player("a"));
    table.sit(1, player("b"));
    table.startHandFromCountdown();
    // Play until someone can check (after call to BB)
    const acting = table.getState().acting!;
    // First actor faces BB — call
    table.applyAction(acting.seatIndex, { action: "call" });
    const next = table.getState().acting!;
    // BB can check
    if (next.callAmount === 0) {
      expect(next.allowedActions).toContain("check");
      expect(next.allowedActions).toContain("raise");
    }
  });

  it("disallows raise when heads-up opponent is all-in and covered", () => {
    const table = new PokerTable(
      { countdownMs: 1, smallBlind: 50, bigBlind: 100, startingStack: 10_000 },
      seededRng(11),
    );
    table.sit(0, player("rich", 10_000));
    table.sit(1, player("short", 150));
    table.startHandFromCountdown();

    // Force short stack all-in by playing actions until short is all-in
    let guard = 0;
    while (guard++ < 40) {
      const state = table.getState();
      if (state.stage === "waiting" || state.stage === "countdown" || state.stage === "showdown") break;
      const acting = state.acting;
      if (!acting) break;
      const seat = state.seats[acting.seatIndex];
      if (seat.player!.chips <= acting.callAmount || seat.player!.id === "short") {
        if (acting.allowedActions.includes("all-in") || acting.allowedActions.includes("call")) {
          try {
            table.applyAction(acting.seatIndex, {
              action: acting.callAmount > 0 ? "call" : "raise",
              amount: seat.player!.chips,
            });
          } catch {
            table.applyAction(acting.seatIndex, { action: "call" });
          }
        } else if (acting.allowedActions.includes("check")) {
          table.applyAction(acting.seatIndex, { action: "check" });
        } else {
          table.applyAction(acting.seatIndex, { action: "fold" });
        }
      } else if (acting.allowedActions.includes("call")) {
        table.applyAction(acting.seatIndex, { action: "call" });
      } else if (acting.allowedActions.includes("check")) {
        table.applyAction(acting.seatIndex, { action: "check" });
      } else {
        break;
      }

      const after = table.getState();
      if (after.acting && after.seats.some((s) => s.status === "all-in")) {
        const info = after.acting;
        const actor = after.seats[info.seatIndex];
        if (actor.player?.id === "rich" && after.seats.some((s) => s.player?.id === "short" && s.status === "all-in")) {
          expect(info.allowedActions).not.toContain("raise");
          expect(info.allowedActions).toContain("call");
          expect(info.allowedActions).toContain("fold");
          break;
        }
      }
    }
  });

  it("short-stack call sends call and caps at stack", () => {
    const table = new PokerTable({ countdownMs: 1, bigBlind: 100, smallBlind: 50 }, seededRng(5));
    table.sit(0, player("a", 10_000));
    table.sit(1, player("b", 80));
    table.startHandFromCountdown();
    const state = table.getState();
    const shortSeat = state.seats.find((s) => s.player?.id === "b")!;
    // Short may already be all-in from BB/SB
    if (shortSeat.status === "all-in") {
      expect(shortSeat.player!.chips).toBe(0);
    } else if (state.acting?.seatIndex === shortSeat.index) {
      const before = shortSeat.player!.chips;
      table.applyAction(shortSeat.index, { action: "call" });
      expect(table.getState().seats[shortSeat.index].player!.chips).toBeLessThan(before);
    }
  });

  it("room investment cap disables full-stack all-in", () => {
    const table = new PokerTable(
      {
        countdownMs: 1,
        bigBlind: 100,
        smallBlind: 50,
        maxInvestmentPerHand: 500,
      },
      seededRng(9),
    );
    table.sit(0, player("a", 10_000));
    table.sit(1, player("b", 10_000));
    table.startHandFromCountdown();
    let guard = 0;
    while (guard++ < 20) {
      const acting = table.getState().acting;
      if (!acting) break;
      if (acting.callAmount === 0) {
        expect(acting.maxRaise).toBeLessThanOrEqual(500);
        if (acting.allowedActions.includes("raise")) {
          expect(acting.maxRaise).toBeLessThan(10_000);
        }
        break;
      }
      table.applyAction(acting.seatIndex, { action: "call" });
    }
  });

  it("rejects out-of-turn action", () => {
    const table = new PokerTable({ countdownMs: 1 }, seededRng(2));
    table.sit(0, player("a"));
    table.sit(1, player("b"));
    table.startHandFromCountdown();
    const acting = table.getState().acting!.seatIndex;
    const other = acting === 0 ? 1 : 0;
    expect(() => table.applyAction(other, { action: "fold" })).toThrow(/turn/i);
  });

  it("fold win awards pot", () => {
    const table = new PokerTable({ countdownMs: 1 }, seededRng(13));
    table.sit(0, player("a"));
    table.sit(1, player("b"));
    table.startHandFromCountdown();
    const before = table.getState();
    const actor = before.acting!.seatIndex;
    const other = actor === 0 ? 1 : 0;
    const otherChips = before.seats[other].player!.chips;
    table.applyAction(actor, { action: "fold" });
    const after = table.getState();
    expect(after.lastResult?.kind).toBe("fold");
    expect(after.lastResult?.winners[0].seatIndex).toBe(other);
    expect(after.lastResult?.winners[0].name).toBeTruthy();
    expect(after.seats[other].player!.chips).toBeGreaterThan(otherChips);
  });

  it("fillBots seats bots", () => {
    const table = new PokerTable();
    table.sit(0, player("human"));
    table.fillBots(3);
    expect(table.seatedCount()).toBe(4);
    expect(table.getState().seats.filter((s) => s.player?.isBot).length).toBe(3);
  });
});
