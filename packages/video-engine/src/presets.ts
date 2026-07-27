/**
 * Container/codec and framing presets.
 *
 * Everything here is constrained to what the bundled ffmpeg core actually
 * supports: `--enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx
 * --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus
 * --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass`.
 */

export type VideoFormatId = "mp4" | "mp4-hevc" | "webm" | "mkv" | "mov";

export type VideoFormatPreset = {
  id: VideoFormatId;
  label: string;
  ext: string;
  mime: string;
  hint: string;
  videoArgs: (crf: number, preset: string) => string[];
  audioArgs: (kbps: number) => string[];
  /** Appended last, after the output-specific flags. */
  containerArgs: string[];
};

export const VIDEO_FORMATS: VideoFormatPreset[] = [
  {
    id: "mp4",
    label: "MP4 · H.264",
    ext: "mp4",
    mime: "video/mp4",
    hint: "Plays everywhere. Best default for uploads.",
    videoArgs: (crf, preset) => ["-c:v", "libx264", "-preset", preset, "-crf", String(crf)],
    audioArgs: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
    containerArgs: ["-movflags", "+faststart"],
  },
  {
    id: "mp4-hevc",
    label: "MP4 · H.265",
    ext: "mp4",
    mime: "video/mp4",
    hint: "~30% smaller than H.264, slower to encode.",
    videoArgs: (crf, preset) => [
      "-c:v",
      "libx265",
      "-preset",
      preset,
      "-crf",
      String(crf + 5),
      "-tag:v",
      "hvc1",
    ],
    audioArgs: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
    containerArgs: ["-movflags", "+faststart"],
  },
  {
    id: "webm",
    label: "WebM · VP9",
    ext: "webm",
    mime: "video/webm",
    hint: "Great for the web. Slowest to encode.",
    videoArgs: (crf, _preset) => [
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      String(crf + 10),
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
    ],
    audioArgs: (kbps) => ["-c:a", "libopus", "-b:a", `${kbps}k`],
    containerArgs: [],
  },
  {
    id: "mkv",
    label: "MKV · H.264",
    ext: "mkv",
    mime: "video/x-matroska",
    hint: "Flexible container for archiving.",
    videoArgs: (crf, preset) => ["-c:v", "libx264", "-preset", preset, "-crf", String(crf)],
    audioArgs: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
    containerArgs: [],
  },
  {
    id: "mov",
    label: "MOV · H.264",
    ext: "mov",
    mime: "video/quicktime",
    hint: "QuickTime / Final Cut friendly.",
    videoArgs: (crf, preset) => ["-c:v", "libx264", "-preset", preset, "-crf", String(crf)],
    audioArgs: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
    containerArgs: ["-movflags", "+faststart"],
  },
];

export function videoFormat(id: string): VideoFormatPreset {
  return VIDEO_FORMATS.find((f) => f.id === id) ?? VIDEO_FORMATS[0]!;
}

export type AudioFormatId = "mp3" | "m4a" | "wav" | "opus" | "flac";

export type AudioFormatPreset = {
  id: AudioFormatId;
  label: string;
  ext: string;
  mime: string;
  lossless: boolean;
  args: (kbps: number) => string[];
};

export const AUDIO_FORMATS: AudioFormatPreset[] = [
  {
    id: "mp3",
    label: "MP3",
    ext: "mp3",
    mime: "audio/mpeg",
    lossless: false,
    args: (kbps) => ["-c:a", "libmp3lame", "-b:a", `${kbps}k`],
  },
  {
    id: "m4a",
    label: "M4A · AAC",
    ext: "m4a",
    mime: "audio/mp4",
    lossless: false,
    args: (kbps) => ["-c:a", "aac", "-b:a", `${kbps}k`],
  },
  {
    id: "opus",
    label: "Opus",
    ext: "opus",
    mime: "audio/ogg",
    lossless: false,
    args: (kbps) => ["-c:a", "libopus", "-b:a", `${kbps}k`],
  },
  {
    id: "wav",
    label: "WAV · PCM",
    ext: "wav",
    mime: "audio/wav",
    lossless: true,
    args: () => ["-c:a", "pcm_s16le"],
  },
  {
    id: "flac",
    label: "FLAC",
    ext: "flac",
    mime: "audio/flac",
    lossless: true,
    args: () => ["-c:a", "flac"],
  },
];

export function audioFormat(id: string): AudioFormatPreset {
  return AUDIO_FORMATS.find((f) => f.id === id) ?? AUDIO_FORMATS[0]!;
}

export type FramePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  hint: string;
};

/** Canvas sizes creators actually publish to. */
export const FRAME_PRESETS: FramePreset[] = [
  { id: "vertical-1080", label: "9:16 Vertical · 1080×1920", width: 1080, height: 1920, hint: "TikTok, Reels, Shorts" },
  { id: "vertical-720", label: "9:16 Vertical · 720×1280", width: 720, height: 1280, hint: "Lighter vertical export" },
  { id: "square-1080", label: "1:1 Square · 1080×1080", width: 1080, height: 1080, hint: "Instagram feed" },
  { id: "portrait-1080", label: "4:5 Portrait · 1080×1350", width: 1080, height: 1350, hint: "Instagram portrait" },
  { id: "wide-2160", label: "16:9 · 3840×2160", width: 3840, height: 2160, hint: "4K UHD" },
  { id: "wide-1440", label: "16:9 · 2560×1440", width: 2560, height: 1440, hint: "1440p" },
  { id: "wide-1080", label: "16:9 · 1920×1080", width: 1920, height: 1080, hint: "YouTube 1080p" },
  { id: "wide-720", label: "16:9 · 1280×720", width: 1280, height: 720, hint: "720p" },
  { id: "cinema-1080", label: "21:9 Cinematic · 2560×1080", width: 2560, height: 1080, hint: "Ultrawide crop" },
  { id: "custom", label: "Custom size", width: 0, height: 0, hint: "Set width and height yourself" },
];

export function framePreset(id: string): FramePreset {
  return FRAME_PRESETS.find((p) => p.id === id) ?? FRAME_PRESETS[0]!;
}

/** libx264/libx265 speed presets, trimmed to the range that is sane in WASM. */
export const ENCODE_PRESETS = [
  { value: "ultrafast", label: "Ultrafast — biggest file" },
  { value: "superfast", label: "Superfast" },
  { value: "veryfast", label: "Very fast (recommended)" },
  { value: "faster", label: "Faster" },
  { value: "medium", label: "Medium — slow in browser" },
];

export const NINE_GRID = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "middle-left", label: "Middle left" },
  { value: "center", label: "Center" },
  { value: "middle-right", label: "Middle right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

/**
 * Overlay x:y expressions for a 9-point grid. `W`/`H` are the base frame and
 * `w`/`h` the overlay, which is the convention the `overlay` filter uses.
 */
export function overlayPosition(position: string, margin: number): { x: string; y: string } {
  const m = String(Math.round(margin));
  const x =
    position.endsWith("left") ? m
    : position.endsWith("right") ? `W-w-${m}`
    : `(W-w)/2`;
  const y =
    position.startsWith("top") ? m
    : position.startsWith("bottom") ? `H-h-${m}`
    : `(H-h)/2`;
  return { x, y };
}

/** `drawtext` uses the same idea but with `text_w`/`text_h`. */
export function textPosition(position: string, margin: number): { x: string; y: string } {
  const m = String(Math.round(margin));
  const x =
    position.endsWith("left") ? m
    : position.endsWith("right") ? `w-text_w-${m}`
    : `(w-text_w)/2`;
  const y =
    position.startsWith("top") ? m
    : position.startsWith("bottom") ? `h-text_h-${m}`
    : `(h-text_h)/2`;
  return { x, y };
}

export function describeCrf(crf: number): string {
  if (crf <= 18) return "Near-lossless · large";
  if (crf <= 22) return "High quality";
  if (crf <= 26) return "Balanced";
  if (crf <= 30) return "Small file";
  return "Heavily compressed";
}
