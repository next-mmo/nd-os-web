/** Groups shown as sections in the toolkit sidebar. */
export type ToolCategory = "convert" | "edit" | "audio" | "create";

export type ToolId =
  | "convert"
  | "compress"
  | "resize"
  | "trim"
  | "merge"
  | "speed"
  | "loop"
  | "rotate"
  | "extract-audio"
  | "audio-mix"
  | "audio-fx"
  | "gif"
  | "thumbnail"
  | "frames"
  | "watermark"
  | "subtitles"
  | "color"
  | "waveform";

/** What a tool is willing to take as its primary input. */
export type MediaKind = "video" | "audio" | "any";

export type MediaInfo = {
  name: string;
  sizeBytes: number;
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  channels: number | null;
};

export type OptionValues = Record<string, string | number | boolean>;

type BaseOption = {
  id: string;
  label: string;
  hint?: string;
  /** Hide the field unless this predicate passes — lets one tool cover several flows. */
  showIf?: (values: OptionValues, info: MediaInfo | null) => boolean;
};

export type OptionSpec =
  | (BaseOption & {
      kind: "select";
      default: string;
      choices: { value: string; label: string; hint?: string }[];
    })
  | (BaseOption & {
      kind: "range";
      default: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
      /** Render the raw number with a friendlier label (e.g. CRF 23 -> "Good"). */
      describe?: (value: number) => string;
    })
  | (BaseOption & {
      kind: "number";
      default: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
    })
  | (BaseOption & { kind: "text"; default: string; placeholder?: string; multiline?: boolean })
  | (BaseOption & { kind: "switch"; default: boolean })
  | (BaseOption & { kind: "color"; default: string })
  /** Seconds, rendered as a hh:mm:ss.ms scrubber bound to the source duration. */
  | (BaseOption & { kind: "time"; default: number; endOfClip?: boolean });

/** A secondary file the tool needs alongside the primary source. */
export type ExtraInputSpec = {
  id: string;
  label: string;
  accept: string;
  required: boolean;
  hint?: string;
  /** Fonts live in a dedicated FS folder and are cached across sessions. */
  role?: "font" | "subtitle" | "audio" | "image";
};

export type ToolSpec = {
  id: ToolId;
  category: ToolCategory;
  title: string;
  tagline: string;
  /** Key resolved to a Lucide component by the UI — keeps this package DOM-free. */
  icon: string;
  accepts: MediaKind;
  /** Takes an ordered list of clips rather than a single source. */
  multiClip?: boolean;
  extras?: ExtraInputSpec[];
  options: OptionSpec[];
  /** Shown as a caution strip above the run button. */
  warning?: string;
};

export type BuildInput = {
  /** Path inside the ffmpeg virtual filesystem. */
  path: string;
  info: MediaInfo | null;
};

export type BuildContext = {
  tool: ToolId;
  values: OptionValues;
  source: BuildInput;
  /** Secondary inputs keyed by `ExtraInputSpec.id`. */
  extras: Record<string, BuildInput>;
  /** Ordered clips for multi-clip tools; `source` is expected to be first. */
  clips?: BuildInput[];
  /** Directory holding the loaded caption font, if any. */
  fontDir?: string | null;
  fontName?: string | null;
  /** Family name read out of the font's `name` table, used by libass matching. */
  fontFamily?: string | null;
};

export type CommandStep = {
  label: string;
  args: string[];
  /**
   * Fraction of total job time this step is expected to take, used to keep the
   * progress bar monotonic across multi-pass jobs. Values are normalised.
   */
  weight?: number;
};

export type OutputSpec =
  | { kind: "file"; path: string; downloadName: string; mime: string }
  | {
      kind: "sequence";
      dir: string;
      /** Filenames are `${prefix}0001.${ext}`. */
      prefix: string;
      ext: string;
      mime: string;
    };

export type BuiltCommand = {
  steps: CommandStep[];
  outputs: OutputSpec[];
  /** Non-fatal notes surfaced in the UI before the job runs. */
  warnings: string[];
  /** Directories to create in the virtual FS before running. */
  mkdirs: string[];
  /**
   * Text files to drop into the virtual FS first. Keeping user strings out of
   * the filtergraph avoids a whole class of escaping bugs.
   */
  writes: { path: string; content: string }[];
};

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobArtifact = {
  name: string;
  mime: string;
  bytes: number;
  url: string;
};

export type VideoJob = {
  id: string;
  tool: ToolId;
  toolTitle: string;
  sourceName: string;
  status: JobStatus;
  progress: number;
  stepLabel: string;
  createdAt: number;
  elapsedMs: number;
  inputBytes: number;
  outputBytes: number;
  artifacts: JobArtifact[];
  error: string | null;
  log: string[];
};
