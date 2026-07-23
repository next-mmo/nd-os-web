import type { ActionRequest, TableState } from "./types";

/** Simple entertainment bot: fold weak, call moderate, occasional raise. */
export function chooseBotAction(state: TableState, seatIndex: number): ActionRequest {
  const acting = state.acting;
  if (!acting || acting.seatIndex !== seatIndex) return { action: "fold" };

  const seat = state.seats[seatIndex];
  const { allowedActions, callAmount, minRaise, maxRaise } = acting;
  const hole = seat.holeCards;
  const strength = roughStrength(hole);

  if (allowedActions.includes("check") && callAmount === 0) {
    if (strength >= 0.7 && allowedActions.includes("raise") && maxRaise >= minRaise) {
      const amount = Math.min(maxRaise, Math.max(minRaise, state.config.bigBlind * 2));
      return { action: "raise", amount };
    }
    return { action: "check" };
  }

  if (callAmount > 0) {
    const potOdds = callAmount / Math.max(1, state.pot + callAmount);
    if (strength < 0.25 && potOdds > 0.2) {
      return { action: "fold" };
    }
    if (strength >= 0.75 && allowedActions.includes("raise") && maxRaise >= minRaise) {
      return { action: "raise", amount: Math.min(maxRaise, minRaise) };
    }
    if (allowedActions.includes("call") || allowedActions.includes("all-in")) {
      return { action: "call" };
    }
    return { action: "fold" };
  }

  return { action: "fold" };
}

function roughStrength(hole: { rank: string }[]): number {
  if (hole.length < 2) return 0.3;
  const high = ["A", "K", "Q", "J", "T"];
  const v0 = high.indexOf(hole[0].rank);
  const v1 = high.indexOf(hole[1].rank);
  let s = 0.3;
  if (hole[0].rank === hole[1].rank) s += 0.45;
  if (v0 >= 0) s += 0.12;
  if (v1 >= 0) s += 0.12;
  return Math.min(1, s);
}
