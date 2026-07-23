export type Suit = "s" | "h" | "d" | "c";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export type Card = { rank: Rank; suit: Suit };

export type Stage =
  | "waiting"
  | "countdown"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown";

export type SeatStatus = "empty" | "seated" | "active" | "folded" | "all-in";

export type WireAction = "fold" | "check" | "call" | "raise";

export type AllowedAction = "fold" | "check" | "call" | "raise" | "all-in";

export type SeatPlayer = {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  isBot: boolean;
  peerId?: string;
};

export type SeatState = {
  index: number;
  player: SeatPlayer | null;
  status: SeatStatus;
  holeCards: Card[];
  /** Chips committed this betting round. */
  currentBet: number;
  /** Chips committed this hand (all streets). */
  totalBet: number;
  /** True when this seat won (or split) the last completed hand. */
  isWinner: boolean;
};

export type SidePot = {
  amount: number;
  eligibleSeatIndexes: number[];
};

export type TableConfig = {
  seatCount: number;
  smallBlind: number;
  bigBlind: number;
  /** Per-hand investment cap; 0 = unlimited. */
  maxInvestmentPerHand: number;
  turnMs: number;
  countdownMs: number;
  startingStack: number;
};

export type ActingInfo = {
  seatIndex: number;
  callAmount: number;
  minRaise: number;
  maxRaise: number;
  allowedActions: AllowedAction[];
  turnEndsAt: number;
};

export type HandResultWinner = {
  seatIndex: number;
  amount: number;
  handName: string;
  name: string;
  avatar: string;
  holeCards: Card[];
};

export type HandResult = {
  kind: "showdown" | "fold";
  winners: HandResultWinner[];
  board: Card[];
  /** Total chips awarded across winners this hand. */
  potWon: number;
};

export type TableState = {
  config: TableConfig;
  seats: SeatState[];
  stage: Stage;
  board: Card[];
  pot: number;
  sidePots: SidePot[];
  dealerIndex: number;
  sbIndex: number;
  bbIndex: number;
  acting: ActingInfo | null;
  handNumber: number;
  lastResult: HandResult | null;
  /** Message for UI / chat-style feed. */
  lastMessage: string;
  countdownEndsAt: number | null;
  version: number;
};

export type ActionRequest = {
  action: WireAction;
  /** Chips added by this raise (not final total). */
  amount?: number;
};

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  seatCount: 6,
  smallBlind: 50,
  bigBlind: 100,
  maxInvestmentPerHand: 0,
  turnMs: 20_000,
  countdownMs: 3_000,
  startingStack: 10_000,
};

export const AVATARS = ["♠", "♥", "♦", "♣", "★", "●", "◆", "▲"] as const;
