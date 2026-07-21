import type { Wallpaper } from "./types";

export const wallpapers: Record<Wallpaper, string> = {
  aurora:
    "radial-gradient(circle at 15% 18%, rgba(45,212,191,.42), transparent 26%), radial-gradient(circle at 80% 15%, rgba(129,140,248,.38), transparent 30%), linear-gradient(145deg, #0f172a 5%, #172554 48%, #0f766e 120%)",
  midnight:
    "radial-gradient(circle at 70% 18%, rgba(99,102,241,.35), transparent 26%), radial-gradient(circle at 20% 82%, rgba(14,165,233,.25), transparent 28%), linear-gradient(145deg, #020617, #111827 52%, #172554)",
  sunrise:
    "radial-gradient(circle at 75% 20%, rgba(253,186,116,.65), transparent 25%), radial-gradient(circle at 22% 70%, rgba(244,114,182,.32), transparent 30%), linear-gradient(145deg, #312e81, #9f1239 55%, #f97316 120%)",
  forest:
    "radial-gradient(circle at 20% 20%, rgba(134,239,172,.3), transparent 25%), radial-gradient(circle at 75% 75%, rgba(45,212,191,.24), transparent 28%), linear-gradient(145deg, #052e16, #14532d 52%, #164e63)",
};
