import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import {
  canClaimDaily,
  claimDailyBankroll,
  DAILY_CLAIM_AMOUNT,
  loadProfile,
  localDayKey,
  saveProfile,
} from "./profile";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    },
  });
});

afterEach(() => {
  memory.clear();
  localStorage.removeItem(STORAGE_KEYS.pokerProfile);
});

describe("daily bankroll claim", () => {
  it("allows claim when never claimed", () => {
    const profile = loadProfile();
    expect(canClaimDaily(profile)).toBe(true);
    const result = claimDailyBankroll(new Date("2026-07-23T10:00:00"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(DAILY_CLAIM_AMOUNT);
      expect(result.profile.bankroll).toBe(50_000 + DAILY_CLAIM_AMOUNT);
      expect(result.profile.lastDailyClaimDate).toBe("2026-07-23");
    }
  });

  it("blocks a second claim on the same local day", () => {
    claimDailyBankroll(new Date("2026-07-23T08:00:00"));
    const again = claimDailyBankroll(new Date("2026-07-23T22:00:00"));
    expect(again.ok).toBe(false);
    expect(canClaimDaily(loadProfile(), new Date("2026-07-23T23:00:00"))).toBe(false);
  });

  it("allows claim again on the next local day", () => {
    const first = claimDailyBankroll(new Date("2026-07-23T12:00:00"));
    expect(first.ok).toBe(true);
    const next = claimDailyBankroll(new Date("2026-07-24T01:00:00"));
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.profile.lastDailyClaimDate).toBe("2026-07-24");
      expect(next.profile.bankroll).toBe(50_000 + DAILY_CLAIM_AMOUNT * 2);
    }
  });

  it("localDayKey formats YYYY-MM-DD", () => {
    expect(localDayKey(new Date(2026, 6, 23))).toBe("2026-07-23");
  });

  it("persists claim date across load", () => {
    const claimed = claimDailyBankroll(new Date("2026-07-23T12:00:00"));
    expect(claimed.ok).toBe(true);
    if (claimed.ok) saveProfile(claimed.profile);
    expect(loadProfile().lastDailyClaimDate).toBe("2026-07-23");
  });
});
