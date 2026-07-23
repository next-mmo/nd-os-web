import { APP_IDS } from "./catalog";
import type { AppId } from "./types";

/**
 * Human-friendly hash slugs for deep links, e.g. `#texas-poker`.
 * Falls back to the AppId when no alias is listed.
 */
const HASH_BY_APP: Partial<Record<AppId, string>> = {
  poker: "texas-poker",
  "tts-studio": "tts-studio",
};

const APP_BY_HASH: Record<string, AppId> = Object.fromEntries(
  APP_IDS.flatMap((id) => {
    const slug = HASH_BY_APP[id] ?? id;
    const entries: [string, AppId][] = [[slug, id], [id, id]];
    return entries;
  }),
) as Record<string, AppId>;

export function hashForApp(id: AppId): string {
  return HASH_BY_APP[id] ?? id;
}

export function appFromHash(hash: string): AppId | null {
  const raw = hash.replace(/^#/, "").trim().toLowerCase();
  if (!raw) return null;
  return APP_BY_HASH[raw] ?? null;
}

export function readAppHash(): AppId | null {
  if (typeof location === "undefined") return null;
  return appFromHash(location.hash);
}

/** Update the URL hash to match the focused app (or clear when none). */
export function syncAppHash(activeId: AppId | null): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const next = activeId ? `#${hashForApp(activeId)}` : "";
  if (location.hash === next) return;
  if (next) {
    history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  } else {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}
