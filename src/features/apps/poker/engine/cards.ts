import type { Card, Rank, Suit } from "./types";

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["s", "h", "d", "c"];

export const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function formatCard(card: Card): string {
  const suitSymbol: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  return `${card.rank}${suitSymbol[card.suit]}`;
}

export function isRed(card: Card): boolean {
  return card.suit === "h" || card.suit === "d";
}
