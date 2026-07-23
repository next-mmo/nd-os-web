import { describe, expect, it } from "vitest";
import { evaluateBestHand } from "./hand-rank";
import type { Card } from "./types";

function c(rank: Card["rank"], suit: Card["suit"]): Card {
  return { rank, suit };
}

describe("evaluateBestHand", () => {
  it("detects a royal flush as straight flush", () => {
    const hand = evaluateBestHand([
      c("A", "s"),
      c("K", "s"),
      c("Q", "s"),
      c("J", "s"),
      c("T", "s"),
      c("2", "h"),
      c("3", "d"),
    ]);
    expect(hand.category).toBe("straight-flush");
  });

  it("detects a wheel straight", () => {
    const hand = evaluateBestHand([
      c("A", "h"),
      c("2", "d"),
      c("3", "c"),
      c("4", "s"),
      c("5", "h"),
      c("K", "d"),
      c("9", "c"),
    ]);
    expect(hand.category).toBe("straight");
    expect(hand.score[1]).toBe(5);
  });

  it("detects full house", () => {
    const hand = evaluateBestHand([
      c("A", "h"),
      c("A", "d"),
      c("A", "c"),
      c("K", "s"),
      c("K", "h"),
      c("2", "d"),
      c("3", "c"),
    ]);
    expect(hand.category).toBe("full-house");
  });

  it("prefers higher pair", () => {
    const a = evaluateBestHand([c("A", "h"), c("A", "d"), c("2", "c"), c("3", "s"), c("4", "h")]);
    const b = evaluateBestHand([c("K", "h"), c("K", "d"), c("2", "c"), c("3", "s"), c("4", "h")]);
    expect(a.score[0]).toBe(b.score[0]);
    expect(a.score[1]).toBeGreaterThan(b.score[1]);
  });
});
