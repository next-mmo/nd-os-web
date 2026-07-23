import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import { AVATARS } from "../engine/types";

export type PokerProfile = {
  displayName: string;
  avatar: string;
  bankroll: number;
  handsPlayed: number;
  handsWon: number;
  /** Local calendar day (YYYY-MM-DD) of last daily bankroll claim. */
  lastDailyClaimDate: string | null;
  updatedAt: number;
};

const DEFAULT_BANKROLL = 50_000;
/** Chips granted once per local calendar day. */
export const DAILY_CLAIM_AMOUNT = 10_000;

function defaultProfile(): PokerProfile {
  return {
    displayName: "Player",
    avatar: AVATARS[0],
    bankroll: DEFAULT_BANKROLL,
    handsPlayed: 0,
    handsWon: 0,
    lastDailyClaimDate: null,
    updatedAt: Date.now(),
  };
}

/** Local calendar day key, e.g. 2026-07-23. */
export function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function loadProfile(): PokerProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pokerProfile);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<PokerProfile>;
    return {
      ...defaultProfile(),
      ...parsed,
      avatar: parsed.avatar && AVATARS.includes(parsed.avatar as (typeof AVATARS)[number])
        ? parsed.avatar
        : defaultProfile().avatar,
      bankroll: typeof parsed.bankroll === "number" ? parsed.bankroll : DEFAULT_BANKROLL,
      handsPlayed: typeof parsed.handsPlayed === "number" ? parsed.handsPlayed : 0,
      handsWon: typeof parsed.handsWon === "number" ? parsed.handsWon : 0,
      lastDailyClaimDate:
        typeof parsed.lastDailyClaimDate === "string" ? parsed.lastDailyClaimDate : null,
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: PokerProfile): void {
  const next = { ...profile, updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEYS.pokerProfile, JSON.stringify(next));
}

export function updateProfile(patch: Partial<PokerProfile>): PokerProfile {
  const next = { ...loadProfile(), ...patch, updatedAt: Date.now() };
  saveProfile(next);
  return next;
}

export function canClaimDaily(profile: PokerProfile = loadProfile(), now = new Date()): boolean {
  return profile.lastDailyClaimDate !== localDayKey(now);
}

export type DailyClaimResult =
  | { ok: true; profile: PokerProfile; amount: number }
  | { ok: false; profile: PokerProfile; reason: "already-claimed" };

/** Claim once per local day; adds chips on top of current bankroll. */
export function claimDailyBankroll(now = new Date()): DailyClaimResult {
  const current = loadProfile();
  const day = localDayKey(now);
  if (current.lastDailyClaimDate === day) {
    return { ok: false, profile: current, reason: "already-claimed" };
  }
  const profile = updateProfile({
    bankroll: current.bankroll + DAILY_CLAIM_AMOUNT,
    lastDailyClaimDate: day,
  });
  return { ok: true, profile, amount: DAILY_CLAIM_AMOUNT };
}

export function topUpBankroll(amount = DEFAULT_BANKROLL): PokerProfile {
  const current = loadProfile();
  return updateProfile({ bankroll: Math.max(current.bankroll, amount) });
}

export function resetBankroll(): PokerProfile {
  return updateProfile({ bankroll: DEFAULT_BANKROLL });
}

export function recordHandResult(won: boolean, chipDelta: number): PokerProfile {
  const current = loadProfile();
  return updateProfile({
    handsPlayed: current.handsPlayed + 1,
    handsWon: current.handsWon + (won ? 1 : 0),
    bankroll: Math.max(0, current.bankroll + chipDelta),
  });
}

export { DEFAULT_BANKROLL };
