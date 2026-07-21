import { appCatalog } from "./catalog";
import type { AppId, AppMeta } from "./types";

export type SpotlightApp = AppMeta & { id: AppId };

/** Fuzzy-match Spotlight query against the app catalog. */
export function searchApps(query: string): SpotlightApp[] {
  const q = query.trim().toLowerCase();
  const all = Object.entries(appCatalog).map(([id, app]) => ({ id: id as AppId, ...app }));
  if (!q) return all;

  return all
    .map((app) => {
      const haystack = `${app.title} ${app.description}`.toLowerCase();
      let score = 0;
      let qi = 0;
      for (let i = 0; i < haystack.length && qi < q.length; i++) {
        if (haystack[i] === q[qi]) {
          score += i === 0 || haystack[i - 1] === " " ? 3 : 1;
          qi++;
        }
      }
      return qi === q.length ? { app, score } : null;
    })
    .filter((r): r is { app: SpotlightApp; score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.app);
}
