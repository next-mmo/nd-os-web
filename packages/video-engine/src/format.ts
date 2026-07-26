export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value < 10 ? 2 : 1)} ${units[i]}`;
}

/** `93.4` -> `1:33.4`. Hours are only shown when present. */
export function formatDuration(seconds: number, showMs = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 10);
  const core = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return showMs ? `${core}.${ms}` : core;
}

/** ffmpeg-safe absolute timestamp: `hh:mm:ss.mmm`. */
export function toTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s
    .toFixed(3)
    .padStart(6, "0")}`;
}

/** Parses `hh:mm:ss.mmm`, `mm:ss`, or a bare seconds string. */
export function parseTimecode(input: string): number {
  const parts = input.trim().split(":");
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return NaN;
  return parts.reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  // Keep output names predictable across OSes and safe inside the ffmpeg FS.
  return stem.replace(/[^\w\-. ]+/g, "_").slice(0, 60) || "output";
}

export function formatBitrate(kbps: number | null): string {
  if (!kbps || kbps <= 0) return "—";
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}
