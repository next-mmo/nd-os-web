import { RANK_VALUE } from "./cards";
import type { Card, Rank } from "./types";

export type HandCategory =
  | "high-card"
  | "one-pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush";

export type RankedHand = {
  category: HandCategory;
  /** Lexicographic score: higher is better. */
  score: number[];
  name: string;
  cards: Card[];
};

const CATEGORY_RANK: Record<HandCategory, number> = {
  "high-card": 0,
  "one-pair": 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 4,
  flush: 5,
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8,
};

const CATEGORY_NAME: Record<HandCategory, string> = {
  "high-card": "High Card",
  "one-pair": "One Pair",
  "two-pair": "Two Pair",
  "three-of-a-kind": "Three of a Kind",
  straight: "Straight",
  flush: "Flush",
  "full-house": "Full House",
  "four-of-a-kind": "Four of a Kind",
  "straight-flush": "Straight Flush",
};

function combinations5(cards: Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return out;
}

function rankFive(cards: Card[]): RankedHand {
  const sorted = [...cards].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
  const values = sorted.map((c) => RANK_VALUE[c.rank]);
  const suits = sorted.map((c) => c.suit);

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const byCount = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const isFlush = suits.every((s) => s === suits[0]);
  const unique = [...new Set(values)].sort((a, b) => b - a);

  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    // Wheel: A-5
    if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
      straightHigh = 5;
    }
  }

  let category: HandCategory;
  let kickers: number[];

  if (isFlush && straightHigh) {
    category = "straight-flush";
    kickers = [straightHigh];
  } else if (byCount[0][1] === 4) {
    category = "four-of-a-kind";
    kickers = [byCount[0][0], byCount[1][0]];
  } else if (byCount[0][1] === 3 && byCount[1][1] === 2) {
    category = "full-house";
    kickers = [byCount[0][0], byCount[1][0]];
  } else if (isFlush) {
    category = "flush";
    kickers = values;
  } else if (straightHigh) {
    category = "straight";
    kickers = [straightHigh];
  } else if (byCount[0][1] === 3) {
    category = "three-of-a-kind";
    kickers = [byCount[0][0], ...byCount.slice(1).map((x) => x[0])];
  } else if (byCount[0][1] === 2 && byCount[1][1] === 2) {
    category = "two-pair";
    const pairs = [byCount[0][0], byCount[1][0]].sort((a, b) => b - a);
    kickers = [...pairs, byCount[2][0]];
  } else if (byCount[0][1] === 2) {
    category = "one-pair";
    kickers = [byCount[0][0], ...byCount.slice(1).map((x) => x[0])];
  } else {
    category = "high-card";
    kickers = values;
  }

  return {
    category,
    score: [CATEGORY_RANK[category], ...kickers],
    name: CATEGORY_NAME[category],
    cards: sorted,
  };
}

function compareScores(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Best 5-card hand from 5–7 cards. */
export function evaluateBestHand(cards: Card[]): RankedHand {
  if (cards.length < 5) {
    throw new Error("Need at least 5 cards to evaluate");
  }
  if (cards.length === 5) return rankFive(cards);

  let best: RankedHand | null = null;
  for (const five of combinations5(cards)) {
    const ranked = rankFive(five);
    if (!best || compareScores(ranked.score, best.score) > 0) best = ranked;
  }
  return best!;
}

export function compareHands(a: Card[], b: Card[]): number {
  return compareScores(evaluateBestHand(a).score, evaluateBestHand(b).score);
}

export function rankLabel(rank: Rank): string {
  return rank === "T" ? "10" : rank;
}
