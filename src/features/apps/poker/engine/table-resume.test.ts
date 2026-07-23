import { describe, expect, it } from "vitest";
import { PokerTable } from "./table";
import type { SeatPlayer } from "./types";

function player(id: string, chips = 10_000, isBot = false): SeatPlayer {
  return { id, name: id, avatar: "♠", chips, isBot };
}

describe("PokerTable resume snapshot", () => {
  it("round-trips mid-hand state", () => {
    const table = new PokerTable({ countdownMs: 1 });
    table.sit(0, player("human"));
    table.sit(1, player("bot", 10_000, true));
    table.startHandFromCountdown();
    const before = table.getState();
    const snap = table.exportSnapshot();
    const restored = PokerTable.fromSnapshot(snap);
    const after = restored.getState();
    expect(after.stage).toBe(before.stage);
    expect(after.handNumber).toBe(before.handNumber);
    expect(after.seats[0].holeCards).toEqual(before.seats[0].holeCards);
    expect(after.pot).toBe(before.pot);
  });

  it("converts remote humans to bots on host resume", () => {
    const table = new PokerTable({ countdownMs: 1 });
    table.sit(0, player("local"));
    table.sit(1, { ...player("guest"), peerId: "peer-1" });
    table.convertRemoteHumansToBots("local");
    const state = table.getState();
    expect(state.seats[0].player?.isBot).toBe(false);
    expect(state.seats[1].player?.isBot).toBe(true);
    expect(state.seats[1].player?.peerId).toBeUndefined();
  });
});
