import {
  AUDIO_FORMATS,
  ENCODE_PRESETS,
  FRAME_PRESETS,
  NINE_GRID,
  VIDEO_FORMATS,
  describeCrf,
} from "./presets";
import type { OptionSpec, OptionValues, ToolCategory, ToolId, ToolSpec } from "./types";

const isCustomFrame = (v: OptionValues) => v.preset === "custom";

const encodePresetOption: OptionSpec = {
  kind: "select",
  id: "encodePreset",
  label: "Encoder speed",
  default: "veryfast",
  hint: "Faster presets finish sooner but produce slightly larger files.",
  choices: ENCODE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
};

const crfOption = (def = 23): OptionSpec => ({
  kind: "range",
  id: "crf",
  label: "Quality",
  default: def,
  min: 14,
  max: 36,
  step: 1,
  describe: describeCrf,
  hint: "Lower means better quality and a bigger file.",
});

const audioBitrateOption: OptionSpec = {
  kind: "select",
  id: "audioKbps",
  label: "Audio bitrate",
  default: "128",
  choices: [
    { value: "96", label: "96 kbps — voice" },
    { value: "128", label: "128 kbps — standard" },
    { value: "192", label: "192 kbps — music" },
    { value: "256", label: "256 kbps — high" },
  ],
};

const framePresetOption: OptionSpec = {
  kind: "select",
  id: "preset",
  label: "Canvas",
  default: "vertical-1080",
  choices: FRAME_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint })),
};

const customWidth: OptionSpec = {
  kind: "number",
  id: "width",
  label: "Width",
  default: 1080,
  min: 16,
  max: 7680,
  step: 2,
  unit: "px",
  showIf: isCustomFrame,
};

const customHeight: OptionSpec = {
  kind: "number",
  id: "height",
  label: "Height",
  default: 1920,
  min: 16,
  max: 7680,
  step: 2,
  unit: "px",
  showIf: isCustomFrame,
};

const startTime: OptionSpec = { kind: "time", id: "start", label: "Start", default: 0 };
const endTime: OptionSpec = { kind: "time", id: "end", label: "End", default: 0, endOfClip: true };

export const TOOLS: Record<ToolId, ToolSpec> = {
  /* ------------------------------------------------------------------ convert */
  convert: {
    id: "convert",
    category: "convert",
    title: "Convert format",
    tagline: "Re-encode to MP4, WebM, MOV, MKV or H.265.",
    icon: "repeat",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "format",
        label: "Output format",
        default: "mp4",
        choices: VIDEO_FORMATS.map((f) => ({ value: f.id, label: f.label, hint: f.hint })),
      },
      crfOption(23),
      encodePresetOption,
      audioBitrateOption,
      {
        kind: "select",
        id: "scaleTo",
        label: "Resolution",
        default: "source",
        choices: [
          { value: "source", label: "Keep original" },
          { value: "2160", label: "Downscale to 2160p" },
          { value: "1440", label: "Downscale to 1440p" },
          { value: "1080", label: "Downscale to 1080p" },
          { value: "720", label: "Downscale to 720p" },
          { value: "480", label: "Downscale to 480p" },
        ],
        hint: "Never upscales — sources already smaller are left alone.",
      },
      {
        kind: "select",
        id: "fps",
        label: "Frame rate",
        default: "source",
        choices: [
          { value: "source", label: "Keep original" },
          { value: "60", label: "60 fps" },
          { value: "30", label: "30 fps" },
          { value: "24", label: "24 fps" },
        ],
      },
      { kind: "switch", id: "stripAudio", label: "Remove audio", default: false },
    ],
  },

  /* ----------------------------------------------------------------- compress */
  compress: {
    id: "compress",
    category: "convert",
    title: "Compress",
    tagline: "Hit an upload limit by quality or by exact target size.",
    icon: "archive",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "mode",
        label: "Compress by",
        default: "quality",
        choices: [
          { value: "quality", label: "Quality level", hint: "One pass, fastest" },
          { value: "size", label: "Target file size", hint: "Two passes, hits a size budget" },
        ],
      },
      { ...crfOption(26), showIf: (v) => v.mode === "quality" },
      {
        kind: "number",
        id: "targetMb",
        label: "Target size",
        default: 8,
        min: 1,
        max: 2000,
        step: 1,
        unit: "MB",
        hint: "Discord free is 10 MB, WhatsApp is 16 MB.",
        showIf: (v) => v.mode === "size",
      },
      encodePresetOption,
      {
        kind: "select",
        id: "scaleTo",
        label: "Resolution",
        default: "source",
        choices: [
          { value: "source", label: "Keep original" },
          { value: "1080", label: "Downscale to 1080p" },
          { value: "720", label: "Downscale to 720p" },
          { value: "480", label: "Downscale to 480p" },
          { value: "360", label: "Downscale to 360p" },
        ],
        hint: "Downscaling saves far more than quality alone.",
      },
      {
        kind: "select",
        id: "audioKbps",
        label: "Audio bitrate",
        default: "96",
        choices: [
          { value: "64", label: "64 kbps — smallest" },
          { value: "96", label: "96 kbps — voice" },
          { value: "128", label: "128 kbps — standard" },
        ],
      },
    ],
  },

  /* ------------------------------------------------------------------- resize */
  resize: {
    id: "resize",
    category: "convert",
    title: "Resize & crop",
    tagline: "Reframe for Shorts, Reels, TikTok or YouTube.",
    icon: "crop",
    accepts: "video",
    options: [
      framePresetOption,
      customWidth,
      customHeight,
      {
        kind: "select",
        id: "fit",
        label: "Fit",
        default: "cover",
        choices: [
          { value: "cover", label: "Crop to fill", hint: "Fills the canvas, trims the edges" },
          { value: "blur", label: "Blurred backdrop", hint: "Whole frame kept, blurred fill behind" },
          { value: "contain", label: "Letterbox", hint: "Whole frame kept on solid bars" },
          { value: "stretch", label: "Stretch", hint: "Distorts to fit exactly" },
        ],
      },
      {
        kind: "color",
        id: "padColor",
        label: "Bar colour",
        default: "#000000",
        showIf: (v) => v.fit === "contain",
      },
      {
        kind: "range",
        id: "blurStrength",
        label: "Backdrop blur",
        default: 20,
        min: 4,
        max: 50,
        step: 2,
        showIf: (v) => v.fit === "blur",
      },
      crfOption(23),
      encodePresetOption,
    ],
  },

  /* --------------------------------------------------------------------- trim */
  trim: {
    id: "trim",
    category: "edit",
    title: "Trim & cut",
    tagline: "Keep just the part you want.",
    icon: "scissors",
    accepts: "any",
    options: [
      startTime,
      endTime,
      {
        kind: "select",
        id: "accuracy",
        label: "Method",
        default: "precise",
        choices: [
          { value: "precise", label: "Frame accurate", hint: "Re-encodes — exact cut points" },
          { value: "fast", label: "Instant (no re-encode)", hint: "Snaps to keyframes, near-instant" },
        ],
      },
      { ...crfOption(21), showIf: (v) => v.accuracy === "precise" },
      { ...encodePresetOption, showIf: (v) => v.accuracy === "precise" },
      {
        kind: "switch",
        id: "fadeEdges",
        label: "Fade in and out",
        default: false,
        hint: "Half-second fade on both ends.",
        showIf: (v) => v.accuracy === "precise",
      },
    ],
  },

  /* -------------------------------------------------------------------- merge */
  merge: {
    id: "merge",
    category: "edit",
    title: "Merge clips",
    tagline: "Join clips end to end, with optional crossfades.",
    icon: "layers",
    accepts: "video",
    multiClip: true,
    options: [
      framePresetOption,
      customWidth,
      customHeight,
      {
        kind: "select",
        id: "fit",
        label: "Fit each clip",
        default: "contain",
        choices: [
          { value: "contain", label: "Letterbox" },
          { value: "cover", label: "Crop to fill" },
          { value: "stretch", label: "Stretch" },
        ],
      },
      {
        kind: "select",
        id: "transition",
        label: "Transition",
        default: "none",
        choices: [
          { value: "none", label: "Hard cut" },
          { value: "fade", label: "Crossfade" },
          { value: "fadeblack", label: "Dip to black" },
          { value: "wipeleft", label: "Wipe left" },
          { value: "slideleft", label: "Slide left" },
        ],
      },
      {
        kind: "range",
        id: "transitionSec",
        label: "Transition length",
        default: 0.5,
        min: 0.2,
        max: 3,
        step: 0.1,
        unit: "s",
        showIf: (v) => v.transition !== "none",
      },
      {
        kind: "select",
        id: "fps",
        label: "Frame rate",
        default: "30",
        choices: [
          { value: "60", label: "60 fps" },
          { value: "30", label: "30 fps" },
          { value: "24", label: "24 fps" },
        ],
        hint: "All clips are conformed to one frame rate before joining.",
      },
      crfOption(23),
      encodePresetOption,
    ],
    warning: "Clips are re-encoded to a common size and frame rate, so this is the slowest tool.",
  },

  /* -------------------------------------------------------------------- speed */
  speed: {
    id: "speed",
    category: "edit",
    title: "Speed & slow-mo",
    tagline: "Speed a clip up or stretch it out.",
    icon: "gauge",
    accepts: "any",
    options: [
      {
        kind: "range",
        id: "rate",
        label: "Playback rate",
        default: 2,
        min: 0.25,
        max: 8,
        step: 0.25,
        unit: "×",
        describe: (r) => (r > 1 ? `${r}× faster` : r < 1 ? `${(1 / r).toFixed(2)}× slower` : "Unchanged"),
      },
      {
        kind: "select",
        id: "audioMode",
        label: "Audio",
        default: "pitch",
        choices: [
          { value: "pitch", label: "Keep pitch", hint: "Speeds audio without chipmunking" },
          { value: "drop", label: "Remove audio" },
        ],
      },
      crfOption(23),
      encodePresetOption,
    ],
  },

  /* --------------------------------------------------------------------- loop */
  loop: {
    id: "loop",
    category: "edit",
    title: "Loop & reverse",
    tagline: "Boomerang, reverse, or repeat a clip.",
    icon: "rotate-ccw",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "mode",
        label: "Effect",
        default: "boomerang",
        choices: [
          { value: "boomerang", label: "Boomerang", hint: "Plays forward then backward" },
          { value: "reverse", label: "Reverse", hint: "Plays backward" },
          { value: "repeat", label: "Repeat", hint: "Loops the clip N times" },
        ],
      },
      {
        kind: "number",
        id: "times",
        label: "Repeats",
        default: 3,
        min: 2,
        max: 20,
        step: 1,
        unit: "×",
        showIf: (v) => v.mode === "repeat",
      },
      {
        kind: "switch",
        id: "keepAudio",
        label: "Keep audio",
        default: false,
        showIf: (v) => v.mode !== "boomerang",
      },
      crfOption(23),
      encodePresetOption,
    ],
    warning: "Reverse and boomerang buffer the whole clip in memory — keep sources under ~30 seconds.",
  },

  /* ------------------------------------------------------------------- rotate */
  rotate: {
    id: "rotate",
    category: "edit",
    title: "Rotate & flip",
    tagline: "Fix sideways phone footage or mirror a shot.",
    icon: "rotate-cw",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "rotation",
        label: "Rotation",
        default: "90cw",
        choices: [
          { value: "none", label: "No rotation" },
          { value: "90cw", label: "90° clockwise" },
          { value: "90ccw", label: "90° counter-clockwise" },
          { value: "180", label: "180°" },
        ],
      },
      {
        kind: "select",
        id: "flip",
        label: "Mirror",
        default: "none",
        choices: [
          { value: "none", label: "None" },
          { value: "h", label: "Horizontal" },
          { value: "v", label: "Vertical" },
        ],
      },
      crfOption(21),
      encodePresetOption,
    ],
  },

  /* ------------------------------------------------------------ extract-audio */
  "extract-audio": {
    id: "extract-audio",
    category: "audio",
    title: "Extract audio",
    tagline: "Pull the soundtrack out as MP3, WAV, M4A, Opus or FLAC.",
    icon: "music",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "format",
        label: "Format",
        default: "mp3",
        choices: AUDIO_FORMATS.map((f) => ({ value: f.id, label: f.label })),
      },
      {
        kind: "select",
        id: "bitrate",
        label: "Bitrate",
        default: "192",
        choices: [
          { value: "128", label: "128 kbps" },
          { value: "192", label: "192 kbps" },
          { value: "256", label: "256 kbps" },
          { value: "320", label: "320 kbps" },
        ],
        showIf: (v) => v.format !== "wav" && v.format !== "flac",
      },
      {
        kind: "select",
        id: "channels",
        label: "Channels",
        default: "source",
        choices: [
          { value: "source", label: "Keep original" },
          { value: "1", label: "Mono" },
          { value: "2", label: "Stereo" },
        ],
      },
      { kind: "switch", id: "trimRange", label: "Only a section", default: false },
      { ...startTime, showIf: (v) => v.trimRange === true },
      { ...endTime, showIf: (v) => v.trimRange === true },
    ],
  },

  /* ---------------------------------------------------------------- audio-mix */
  "audio-mix": {
    id: "audio-mix",
    category: "audio",
    title: "Add soundtrack",
    tagline: "Replace or mix in music, voiceover or a sound bed.",
    icon: "music-2",
    accepts: "video",
    extras: [
      {
        id: "track",
        label: "Audio track",
        accept: "audio/*",
        required: true,
        role: "audio",
        hint: "MP3, WAV, M4A, Opus or FLAC.",
      },
    ],
    options: [
      {
        kind: "select",
        id: "mode",
        label: "Mode",
        default: "replace",
        choices: [
          { value: "replace", label: "Replace original audio" },
          { value: "mix", label: "Mix over original audio" },
        ],
      },
      {
        kind: "range",
        id: "trackVolume",
        label: "Track volume",
        default: 0,
        min: -30,
        max: 12,
        step: 1,
        unit: "dB",
      },
      {
        kind: "range",
        id: "originalVolume",
        label: "Original volume",
        default: -12,
        min: -40,
        max: 6,
        step: 1,
        unit: "dB",
        showIf: (v) => v.mode === "mix",
        hint: "Duck the original so the new track sits on top.",
      },
      {
        kind: "switch",
        id: "loopTrack",
        label: "Loop track to video length",
        default: true,
      },
      { kind: "range", id: "fadeIn", label: "Fade in", default: 0, min: 0, max: 10, step: 0.5, unit: "s" },
      { kind: "range", id: "fadeOut", label: "Fade out", default: 1.5, min: 0, max: 10, step: 0.5, unit: "s" },
    ],
  },

  /* ----------------------------------------------------------------- audio-fx */
  "audio-fx": {
    id: "audio-fx",
    category: "audio",
    title: "Audio cleanup",
    tagline: "Normalise loudness, adjust gain, fade and denoise.",
    icon: "sliders-horizontal",
    accepts: "any",
    options: [
      {
        kind: "switch",
        id: "normalize",
        label: "Normalise loudness",
        default: true,
        hint: "EBU R128 to −16 LUFS, the usual target for online video.",
      },
      { kind: "range", id: "gain", label: "Gain", default: 0, min: -20, max: 20, step: 1, unit: "dB" },
      { kind: "switch", id: "denoise", label: "Reduce background noise", default: false },
      { kind: "range", id: "fadeIn", label: "Fade in", default: 0, min: 0, max: 10, step: 0.5, unit: "s" },
      { kind: "range", id: "fadeOut", label: "Fade out", default: 0, min: 0, max: 10, step: 0.5, unit: "s" },
      {
        kind: "select",
        id: "output",
        label: "Output",
        default: "same",
        choices: [
          { value: "same", label: "Same file with new audio", hint: "Video is copied untouched" },
          { value: "mp3", label: "Audio only — MP3" },
          { value: "wav", label: "Audio only — WAV" },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------------- gif */
  gif: {
    id: "gif",
    category: "create",
    title: "GIF maker",
    tagline: "High-quality looping GIF or animated WebP.",
    icon: "film",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "format",
        label: "Format",
        default: "gif",
        choices: [
          { value: "gif", label: "GIF", hint: "Universal, larger files" },
          { value: "webp", label: "Animated WebP", hint: "Far smaller, modern browsers" },
        ],
      },
      startTime,
      endTime,
      {
        kind: "select",
        id: "fps",
        label: "Frame rate",
        default: "15",
        choices: [
          { value: "10", label: "10 fps — smallest" },
          { value: "15", label: "15 fps — balanced" },
          { value: "20", label: "20 fps" },
          { value: "25", label: "25 fps — smoothest" },
        ],
      },
      {
        kind: "select",
        id: "width",
        label: "Width",
        default: "480",
        choices: [
          { value: "240", label: "240 px" },
          { value: "320", label: "320 px" },
          { value: "480", label: "480 px" },
          { value: "640", label: "640 px" },
          { value: "source", label: "Original width" },
        ],
      },
      {
        kind: "select",
        id: "colors",
        label: "Colours",
        default: "256",
        choices: [
          { value: "64", label: "64 — smallest" },
          { value: "128", label: "128" },
          { value: "256", label: "256 — best quality" },
        ],
        showIf: (v) => v.format === "gif",
      },
      {
        kind: "select",
        id: "dither",
        label: "Dithering",
        default: "bayer",
        choices: [
          { value: "bayer", label: "Bayer — crisp, smaller" },
          { value: "sierra2_4a", label: "Sierra — smoother gradients" },
          { value: "none", label: "None — flat, smallest" },
        ],
        showIf: (v) => v.format === "gif",
      },
      {
        kind: "range",
        id: "quality",
        label: "Quality",
        default: 75,
        min: 30,
        max: 95,
        step: 5,
        showIf: (v) => v.format === "webp",
      },
    ],
    warning: "Keep clips short — GIFs balloon fast past a few seconds.",
  },

  /* ---------------------------------------------------------------- thumbnail */
  thumbnail: {
    id: "thumbnail",
    category: "create",
    title: "Grab a frame",
    tagline: "Pull a still for a thumbnail or poster image.",
    icon: "image",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "pick",
        label: "Frame",
        default: "at",
        choices: [
          { value: "at", label: "At a timestamp" },
          { value: "smart", label: "Most representative", hint: "Scans for the least blurry frame" },
        ],
      },
      { ...startTime, label: "Timestamp", showIf: (v) => v.pick === "at" },
      {
        kind: "select",
        id: "format",
        label: "Format",
        default: "jpg",
        choices: [
          { value: "jpg", label: "JPEG" },
          { value: "png", label: "PNG — lossless" },
          { value: "webp", label: "WebP" },
        ],
      },
      {
        kind: "select",
        id: "width",
        label: "Width",
        default: "source",
        choices: [
          { value: "source", label: "Original" },
          { value: "1920", label: "1920 px" },
          { value: "1280", label: "1280 px" },
          { value: "640", label: "640 px" },
        ],
      },
      {
        kind: "range",
        id: "quality",
        label: "Quality",
        default: 3,
        min: 1,
        max: 15,
        step: 1,
        describe: (q) => (q <= 3 ? "Excellent" : q <= 7 ? "Good" : "Compact"),
        showIf: (v) => v.format !== "png",
      },
    ],
  },

  /* ------------------------------------------------------------------- frames */
  frames: {
    id: "frames",
    category: "create",
    title: "Export frames",
    tagline: "Turn a section into a numbered image sequence.",
    icon: "images",
    accepts: "video",
    options: [
      startTime,
      endTime,
      {
        kind: "select",
        id: "rate",
        label: "Capture",
        default: "1",
        choices: [
          { value: "0.2", label: "1 frame every 5 s" },
          { value: "1", label: "1 frame per second" },
          { value: "2", label: "2 frames per second" },
          { value: "5", label: "5 frames per second" },
          { value: "source", label: "Every frame" },
        ],
      },
      {
        kind: "select",
        id: "format",
        label: "Format",
        default: "jpg",
        choices: [
          { value: "jpg", label: "JPEG" },
          { value: "png", label: "PNG — lossless" },
        ],
      },
      {
        kind: "select",
        id: "width",
        label: "Width",
        default: "source",
        choices: [
          { value: "source", label: "Original" },
          { value: "1920", label: "1920 px" },
          { value: "1280", label: "1280 px" },
          { value: "640", label: "640 px" },
        ],
      },
      {
        kind: "number",
        id: "limit",
        label: "Maximum frames",
        default: 120,
        min: 1,
        max: 2000,
        step: 10,
        hint: "Guards against filling memory with thousands of stills.",
      },
    ],
  },

  /* ---------------------------------------------------------------- watermark */
  watermark: {
    id: "watermark",
    category: "create",
    title: "Watermark",
    tagline: "Brand a clip with a logo or a text overlay.",
    icon: "stamp",
    accepts: "video",
    extras: [
      {
        id: "logo",
        label: "Logo image",
        accept: "image/*",
        required: false,
        role: "image",
        hint: "PNG with transparency works best.",
      },
      {
        id: "font",
        label: "Font file",
        accept: ".ttf,.otf,font/ttf,font/otf",
        required: false,
        role: "font",
        hint: "A .ttf or .otf is required for text overlays. Cached after the first upload.",
      },
    ],
    options: [
      {
        kind: "select",
        id: "kind",
        label: "Watermark type",
        default: "text",
        choices: [
          { value: "text", label: "Text" },
          { value: "image", label: "Logo image" },
        ],
      },
      {
        kind: "text",
        id: "text",
        label: "Text",
        default: "@yourhandle",
        placeholder: "@yourhandle",
        showIf: (v) => v.kind === "text",
      },
      {
        kind: "range",
        id: "fontSize",
        label: "Text size",
        default: 4,
        min: 1.5,
        max: 15,
        step: 0.5,
        unit: "% of height",
        showIf: (v) => v.kind === "text",
      },
      {
        kind: "color",
        id: "color",
        label: "Text colour",
        default: "#ffffff",
        showIf: (v) => v.kind === "text",
      },
      {
        kind: "select",
        id: "backdrop",
        label: "Backdrop",
        default: "shadow",
        choices: [
          { value: "none", label: "None" },
          { value: "shadow", label: "Drop shadow" },
          { value: "box", label: "Solid box" },
        ],
        showIf: (v) => v.kind === "text",
      },
      {
        kind: "range",
        id: "scale",
        label: "Logo size",
        default: 15,
        min: 3,
        max: 60,
        step: 1,
        unit: "% of width",
        showIf: (v) => v.kind === "image",
      },
      { kind: "select", id: "position", label: "Position", default: "bottom-right", choices: NINE_GRID },
      { kind: "range", id: "opacity", label: "Opacity", default: 85, min: 10, max: 100, step: 5, unit: "%" },
      { kind: "range", id: "margin", label: "Edge margin", default: 24, min: 0, max: 200, step: 4, unit: "px" },
      crfOption(21),
      encodePresetOption,
    ],
  },

  /* ---------------------------------------------------------------- subtitles */
  subtitles: {
    id: "subtitles",
    category: "create",
    title: "Burn captions",
    tagline: "Bake an SRT, VTT or ASS file permanently into the picture.",
    icon: "captions",
    accepts: "video",
    extras: [
      {
        id: "subs",
        label: "Caption file",
        accept: ".srt,.vtt,.ass,.ssa,text/vtt",
        required: true,
        role: "subtitle",
      },
      {
        id: "font",
        label: "Font file",
        accept: ".ttf,.otf,font/ttf,font/otf",
        required: true,
        role: "font",
        hint: "Required — the bundled ffmpeg has no fonts of its own. Cached after the first upload.",
      },
    ],
    options: [
      {
        kind: "range",
        id: "fontSize",
        label: "Caption size",
        default: 24,
        min: 10,
        max: 72,
        step: 1,
        hint: "Sized against a 384-pixel-tall reference frame, like most caption tools.",
      },
      { kind: "color", id: "color", label: "Text colour", default: "#ffffff" },
      { kind: "color", id: "outlineColor", label: "Outline colour", default: "#000000" },
      { kind: "range", id: "outline", label: "Outline width", default: 2, min: 0, max: 6, step: 1 },
      {
        kind: "select",
        id: "position",
        label: "Position",
        default: "bottom",
        choices: [
          { value: "bottom", label: "Bottom" },
          { value: "middle", label: "Middle" },
          { value: "top", label: "Top" },
        ],
      },
      {
        kind: "range",
        id: "marginV",
        label: "Distance from edge",
        default: 30,
        min: 0,
        max: 200,
        step: 5,
        hint: "Measured in caption units against the same 384-pixel reference frame.",
      },
      { kind: "switch", id: "bold", label: "Bold", default: true },
      { kind: "switch", id: "shadowBox", label: "Semi-transparent box behind text", default: false },
      crfOption(21),
      encodePresetOption,
    ],
    warning: "Styling options apply to SRT and VTT. ASS files keep their own embedded styling.",
  },

  /* -------------------------------------------------------------------- color */
  color: {
    id: "color",
    category: "create",
    title: "Colour & filters",
    tagline: "Grade, sharpen, blur or add a vignette.",
    icon: "palette",
    accepts: "video",
    options: [
      {
        kind: "select",
        id: "look",
        label: "Look",
        default: "none",
        choices: [
          { value: "none", label: "Manual only" },
          { value: "warm", label: "Warm" },
          { value: "cool", label: "Cool" },
          { value: "cinematic", label: "Cinematic — teal & orange" },
          { value: "vivid", label: "Vivid" },
          { value: "bw", label: "Black & white" },
          { value: "vintage", label: "Vintage" },
        ],
      },
      { kind: "range", id: "brightness", label: "Brightness", default: 0, min: -0.5, max: 0.5, step: 0.02 },
      { kind: "range", id: "contrast", label: "Contrast", default: 1, min: 0.4, max: 2.5, step: 0.05 },
      { kind: "range", id: "saturation", label: "Saturation", default: 1, min: 0, max: 3, step: 0.05 },
      { kind: "range", id: "gamma", label: "Gamma", default: 1, min: 0.4, max: 2.5, step: 0.05 },
      { kind: "range", id: "sharpen", label: "Sharpen", default: 0, min: 0, max: 3, step: 0.1 },
      { kind: "range", id: "blur", label: "Blur", default: 0, min: 0, max: 20, step: 1 },
      { kind: "range", id: "vignette", label: "Vignette", default: 0, min: 0, max: 100, step: 5, unit: "%" },
      crfOption(21),
      encodePresetOption,
    ],
  },

  /* ----------------------------------------------------------------- waveform */
  waveform: {
    id: "waveform",
    category: "create",
    title: "Audiogram",
    tagline: "Turn audio into a shareable waveform video.",
    icon: "audio-waveform",
    accepts: "any",
    options: [
      framePresetOption,
      customWidth,
      customHeight,
      {
        kind: "select",
        id: "style",
        label: "Waveform style",
        default: "line",
        choices: [
          { value: "line", label: "Line" },
          { value: "p2p", label: "Peak to peak" },
          { value: "cline", label: "Centred bars" },
        ],
      },
      { kind: "color", id: "waveColor", label: "Waveform colour", default: "#7c5cff" },
      { kind: "color", id: "bgColor", label: "Background colour", default: "#0b0b12" },
      {
        kind: "range",
        id: "waveHeight",
        label: "Waveform height",
        default: 40,
        min: 15,
        max: 100,
        step: 5,
        unit: "% of canvas",
      },
      { kind: "switch", id: "trimRange", label: "Only a section", default: false },
      { ...startTime, showIf: (v) => v.trimRange === true },
      { ...endTime, showIf: (v) => v.trimRange === true },
      crfOption(23),
      encodePresetOption,
    ],
    warning: "Renders one video frame per audio window — long tracks take a while.",
  },
};

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  convert: "Convert & compress",
  edit: "Edit & arrange",
  audio: "Audio",
  create: "Create & brand",
};

export const CATEGORY_ORDER: ToolCategory[] = ["convert", "edit", "audio", "create"];

export function toolsInCategory(category: ToolCategory): ToolSpec[] {
  return TOOL_IDS.map((id) => TOOLS[id]).filter((t) => t.category === category);
}

/** Fresh option values for a tool, using each spec's declared default. */
export function defaultValues(toolId: ToolId): OptionValues {
  const values: OptionValues = {};
  for (const opt of TOOLS[toolId].options) {
    values[opt.id] = opt.default;
  }
  return values;
}

export function visibleOptions(toolId: ToolId, values: OptionValues, info: import("./types").MediaInfo | null): OptionSpec[] {
  return TOOLS[toolId].options.filter((opt) => !opt.showIf || opt.showIf(values, info));
}
