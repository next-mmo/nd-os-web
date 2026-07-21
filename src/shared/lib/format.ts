/** Human-readable byte size for file listings. */
export function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Emoji icon heuristic based on file extension. */
export function iconForFile(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "markdown"].includes(ext)) return "📝";
  if (["txt"].includes(ext)) return "📄";
  if (["json"].includes(ext)) return "🧩";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "🖼️";
  if (["js", "ts", "html", "css", "svelte"].includes(ext)) return "📐";
  return "📄";
}

export function formatTime(date: Date, showSeconds: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
