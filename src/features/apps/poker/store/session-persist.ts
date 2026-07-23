import { STORAGE_KEYS } from "@/shared/config/storage-keys";
import type { PokerTableSnapshot } from "../engine";

export type PlayMode = "solo" | "host" | "guest";

export type PokerSessionSnapshot = {
  v: 1;
  mode: PlayMode;
  mySeatIndex: number | null;
  /** Guest rejoin target, or last host id (host gets a new id on resume). */
  roomCode: string | null;
  handStartChips: number;
  recordedHandVersion: number;
  statusText: string;
  table: PokerTableSnapshot | null;
  savedAt: number;
};

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadSessionSnapshot(): PokerSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pokerSession);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PokerSessionSnapshot;
    if (parsed?.v !== 1 || !parsed.mode) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearSessionSnapshot();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionSnapshot(snapshot: PokerSessionSnapshot): void {
  localStorage.setItem(
    STORAGE_KEYS.pokerSession,
    JSON.stringify({ ...snapshot, savedAt: Date.now(), v: 1 as const }),
  );
}

export function clearSessionSnapshot(): void {
  localStorage.removeItem(STORAGE_KEYS.pokerSession);
}

export function hasResumableSession(): boolean {
  return loadSessionSnapshot() !== null;
}

/** Solo/host with a table can restore offline; guest needs a live host. */
export function canAutoResumeSession(snap = loadSessionSnapshot()): boolean {
  if (!snap) return false;
  if (snap.mode === "solo") return Boolean(snap.table?.state);
  if (snap.mode === "host") return Boolean(snap.table?.state);
  return false;
}

export function isValidTableSnapshot(table: PokerSessionSnapshot["table"]): boolean {
  if (!table?.state?.seats || !Array.isArray(table.deck)) return false;
  if (!table.state.config || typeof table.currentBet !== "number") return false;
  return true;
}
