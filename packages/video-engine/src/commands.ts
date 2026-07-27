import { audioFormat, framePreset, overlayPosition, textPosition, videoFormat } from "./presets";
import { fileExtension } from "./format";
import type {
  BuildContext,
  BuildInput,
  BuiltCommand,
  CommandStep,
  MediaInfo,
  OptionValues,
} from "./types";

/*
 * Builders return the argument vector *without* a leading `-y`; the runner
 * prepends it. Everything here is pure so the argument shapes can be unit
 * tested without booting the 31 MB WASM core.
 */

export const SOURCE_PATH = "src";
export const OUT_DIR = "out";
export const FONT_DIR = "fonts";
export const TEXT_DIR = "text";
export const FRAMES_DIR = "frames";

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown, fallback = ""): string => (v == null ? fallback : String(v));
const bool = (v: unknown): boolean => v === true || v === "true";
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

export function hexToFfmpegColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? `0x${m[1]!.toUpperCase()}` : "0x000000";
}

/** ASS colours are `&HAABBGGRR` — byte-reversed RGB with an alpha prefix. */
export function hexToAssColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const aa = Math.round(Math.min(255, Math.max(0, alpha)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  if (!m) return `&H${aa}FFFFFF`;
  const [, r, g, b] = m;
  return `&H${aa}${b!.toUpperCase()}${g!.toUpperCase()}${r!.toUpperCase()}`;
}

/**
 * `atempo` is only well-behaved between 0.5× and 2×, so larger changes are
 * decomposed into a chain of in-range steps.
 */
export function atempoChain(rate: number): string {
  const safe = Math.min(16, Math.max(1 / 16, rate));
  const parts: number[] = [];
  let r = safe;
  while (r > 2) {
    parts.push(2);
    r /= 2;
  }
  while (r < 0.5) {
    parts.push(0.5);
    r /= 0.5;
  }
  parts.push(r);
  return parts.map((p) => `atempo=${round(p, 6)}`).join(",");
}

/** Resolved start/end/duration for tools with a time range. */
export function timeRange(
  values: OptionValues,
  info: MediaInfo | null,
  startId = "start",
  endId = "end",
): { start: number; end: number; duration: number } {
  const total = info?.durationSec ?? 0;
  const start = Math.max(0, num(values[startId]));
  const rawEnd = num(values[endId]);
  const end = rawEnd > 0 ? rawEnd : total;
  const clampedEnd = total > 0 ? Math.min(end, total) : end;
  return { start, end: clampedEnd, duration: Math.max(0, clampedEnd - start) };
}

/**
 * Downscale filter that never upscales and respects orientation, so "720p"
 * means 720 px on the short edge for vertical footage too.
 */
export function downscaleFilter(info: MediaInfo | null, target: number): string | null {
  if (!info || !info.width || !info.height) return `scale=-2:${even(target)}`;
  const portrait = info.height > info.width;
  const shortEdge = portrait ? info.width : info.height;
  if (shortEdge <= target) return null;
  return portrait ? `scale=${even(target)}:-2` : `scale=-2:${even(target)}`;
}

/** Guarantees even dimensions, which libx264/libx265 require for yuv420p. */
const EVEN_GUARD = "pad=ceil(iw/2)*2:ceil(ih/2)*2";

function resolveFrameSize(values: OptionValues): { width: number; height: number } {
  const preset = framePreset(str(values.preset, "vertical-1080"));
  if (preset.id === "custom") {
    return { width: even(num(values.width, 1080)), height: even(num(values.height, 1920)) };
  }
  return { width: preset.width, height: preset.height };
}

/** scale/crop/pad chain that fits a source into a fixed canvas. */
export function fitFilter(
  width: number,
  height: number,
  fit: string,
  padColor = "#000000",
  blurStrength = 20,
): { chain: string; complex: boolean } {
  switch (fit) {
    case "cover":
      return {
        chain: `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
        complex: false,
      };
    case "contain":
      return {
        chain:
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${hexToFfmpegColor(padColor)},setsar=1`,
        complex: false,
      };
    case "blur":
      // Blurred copy of the frame fills the canvas behind the untouched frame.
      return {
        chain:
          `split[bgsrc][fgsrc];` +
          `[bgsrc]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
          `boxblur=${Math.round(blurStrength)}:2[bg];` +
          `[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
          `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`,
        complex: true,
      };
    default:
      return { chain: `scale=${width}:${height},setsar=1`, complex: false };
  }
}

/** Copy AAC through untouched, otherwise transcode so MP4 muxing succeeds. */
function audioForMp4(info: MediaInfo | null, kbps = 160): string[] {
  if (!info?.hasAudio) return ["-an"];
  return info.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", `${kbps}k`];
}

function x264(values: OptionValues, defaultCrf = 23): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    str(values.encodePreset, "veryfast"),
    "-crf",
    String(num(values.crf, defaultCrf)),
    "-pix_fmt",
    "yuv420p",
  ];
}

function outPath(ext: string): string {
  return `${OUT_DIR}/output.${ext}`;
}

function empty(): BuiltCommand {
  return { steps: [], outputs: [], warnings: [], mkdirs: [], writes: [] };
}

/** Builds the full ffmpeg plan for a tool. Throws on unusable configuration. */
export function buildCommand(ctx: BuildContext): BuiltCommand {
  const result = empty();
  result.mkdirs.push(OUT_DIR);
  const { values, source } = ctx;
  const info = source.info;
  const src = source.path;

  const push = (label: string, args: string[], weight = 1) =>
    result.steps.push({ label, args, weight } satisfies CommandStep);
  const single = (ext: string, mime: string, name: string) => {
    const path = outPath(ext);
    result.outputs.push({ kind: "file", path, downloadName: `${name}.${ext}`, mime });
    return path;
  };

  switch (ctx.tool) {
    /* ---------------------------------------------------------- convert */
    case "convert": {
      const fmt = videoFormat(str(values.format, "mp4"));
      const out = single(fmt.ext, fmt.mime, "converted");
      const filters: string[] = [];
      const scaleTo = str(values.scaleTo, "source");
      if (scaleTo !== "source") {
        const f = downscaleFilter(info, Number(scaleTo));
        if (f) filters.push(f);
        else result.warnings.push("Source is already at or below that resolution — left unscaled.");
      }
      const args = ["-i", src];
      if (filters.length) args.push("-vf", filters.join(","));
      args.push(...fmt.videoArgs(num(values.crf, 23), str(values.encodePreset, "veryfast")));
      const fps = str(values.fps, "source");
      if (fps !== "source") args.push("-r", fps);
      if (bool(values.stripAudio) || !info?.hasAudio) args.push("-an");
      else args.push(...fmt.audioArgs(num(values.audioKbps, 128)));
      args.push(...fmt.containerArgs, out);
      push(`Encoding ${fmt.label}`, args);
      break;
    }

    /* --------------------------------------------------------- compress */
    case "compress": {
      const out = single("mp4", "video/mp4", "compressed");
      const filters: string[] = [];
      const scaleTo = str(values.scaleTo, "source");
      if (scaleTo !== "source") {
        const f = downscaleFilter(info, Number(scaleTo));
        if (f) filters.push(f);
      }
      const vf = filters.length ? ["-vf", filters.join(",")] : [];
      const aKbps = num(values.audioKbps, 96);
      const hasAudio = info?.hasAudio ?? true;
      const audioArgs = hasAudio ? ["-c:a", "aac", "-b:a", `${aKbps}k`] : ["-an"];

      if (str(values.mode, "quality") === "size") {
        const duration = info?.durationSec ?? 0;
        if (duration <= 0) {
          throw new Error("Target-size mode needs the clip duration. Re-add the file and try again.");
        }
        const targetMb = num(values.targetMb, 8);
        // 2% muxing headroom keeps the result under the requested ceiling.
        const totalKbps = (targetMb * 8 * 1024) / duration;
        const videoKbps = Math.floor(totalKbps * 0.98 - (hasAudio ? aKbps : 0));
        if (videoKbps < 80) {
          throw new Error(
            `${targetMb} MB is too small for ${Math.round(duration)}s of video. Raise the target or lower the resolution.`,
          );
        }
        result.warnings.push(`Encoding at about ${videoKbps} kbps video to land near ${targetMb} MB.`);
        const common = [
          "-i",
          src,
          ...vf,
          "-c:v",
          "libx264",
          "-preset",
          str(values.encodePreset, "veryfast"),
          "-b:v",
          `${videoKbps}k`,
          "-pix_fmt",
          "yuv420p",
          "-passlogfile",
          `${OUT_DIR}/pass`,
        ];
        push("Analysing (pass 1 of 2)", [...common, "-pass", "1", "-an", "-f", "null", "/dev/null"], 0.9);
        push("Encoding (pass 2 of 2)", [...common, "-pass", "2", ...audioArgs, "-movflags", "+faststart", out], 1.1);
      } else {
        push("Compressing", [
          "-i",
          src,
          ...vf,
          ...x264(values, 26),
          ...audioArgs,
          "-movflags",
          "+faststart",
          out,
        ]);
      }
      break;
    }

    /* ----------------------------------------------------------- resize */
    case "resize": {
      const { width, height } = resolveFrameSize(values);
      const out = single("mp4", "video/mp4", `resized_${width}x${height}`);
      const fit = fitFilter(
        width,
        height,
        str(values.fit, "cover"),
        str(values.padColor, "#000000"),
        num(values.blurStrength, 20),
      );
      const args = ["-i", src];
      if (fit.complex) {
        args.push("-filter_complex", `[0:v]${fit.chain}[v]`, "-map", "[v]", "-map", "0:a?");
      } else {
        args.push("-vf", fit.chain);
      }
      args.push(...x264(values, 23), ...audioForMp4(info), "-movflags", "+faststart", out);
      push(`Reframing to ${width}×${height}`, args);
      break;
    }

    /* ------------------------------------------------------------- trim */
    case "trim": {
      const { start, duration } = timeRange(values, info);
      if (duration <= 0) throw new Error("The end point must come after the start point.");
      const audioOnlySource = info != null && !info.hasVideo;
      const srcExt = fileExtension(src) || "mp4";

      if (str(values.accuracy, "precise") === "fast") {
        const out = single(srcExt, info?.hasVideo === false ? "audio/mpeg" : "video/mp4", "trimmed");
        push("Cutting", [
          "-ss",
          String(round(start, 3)),
          "-i",
          src,
          "-t",
          String(round(duration, 3)),
          "-c",
          "copy",
          "-avoid_negative_ts",
          "make_zero",
          out,
        ]);
        result.warnings.push("Instant mode snaps to the nearest keyframe, so the cut can drift by a second or two.");
      } else if (audioOnlySource) {
        const out = single("mp3", "audio/mpeg", "trimmed");
        const af = bool(values.fadeEdges) ? buildFades(duration, 0.5, 0.5, true) : [];
        const args = ["-ss", String(round(start, 3)), "-i", src, "-t", String(round(duration, 3))];
        if (af.length) args.push("-af", af.join(","));
        args.push("-c:a", "libmp3lame", "-b:a", "192k", out);
        push("Cutting", args);
      } else {
        const out = single("mp4", "video/mp4", "trimmed");
        const args = ["-ss", String(round(start, 3)), "-i", src, "-t", String(round(duration, 3))];
        if (bool(values.fadeEdges)) {
          const d = Math.min(0.5, duration / 2);
          args.push("-vf", `fade=t=in:st=0:d=${d},fade=t=out:st=${round(duration - d, 3)}:d=${d}`);
          if (info?.hasAudio) {
            args.push("-af", buildFades(duration, d, d, true).join(","));
          }
        }
        args.push(...x264(values, 21));
        args.push(...(info?.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]));
        args.push("-movflags", "+faststart", out);
        push("Cutting", args);
      }
      break;
    }

    /* ------------------------------------------------------------ merge */
    case "merge": {
      const clips = ctx.clips ?? [];
      if (clips.length < 2) throw new Error("Add at least two clips to merge.");
      const { width, height } = resolveFrameSize(values);
      const fps = num(values.fps, 30);
      const out = single("mp4", "video/mp4", "merged");
      const transition = str(values.transition, "none");
      const xdur = num(values.transitionSec, 0.5);
      const fit = fitFilter(width, height, str(values.fit, "contain"));

      const silentFor: number[] = [];
      clips.forEach((clip, i) => {
        if (!(clip.info?.hasAudio ?? true)) silentFor.push(i);
      });

      const args: string[] = [];
      for (const clip of clips) args.push("-i", clip.path);
      // Each silent clip gets its own bounded null source so `concat`/`acrossfade`
      // always see a matching audio stream per segment.
      const silenceIndex = new Map<number, number>();
      for (const i of silentFor) {
        const dur = clips[i]!.info?.durationSec ?? 1;
        silenceIndex.set(i, clips.length + silenceIndex.size);
        args.push("-f", "lavfi", "-t", String(round(dur, 3)), "-i", "anullsrc=r=48000:cl=stereo");
      }

      const graph: string[] = [];
      clips.forEach((_, i) => {
        graph.push(`[${i}:v]${fit.chain},fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
        const aIdx = silenceIndex.has(i) ? silenceIndex.get(i)! : i;
        graph.push(
          `[${aIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
        );
      });

      if (transition === "none") {
        const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join("");
        graph.push(`${pairs}concat=n=${clips.length}:v=1:a=1[outv][outa]`);
      } else {
        const durations = clips.map((c) => c.info?.durationSec ?? 0);
        if (durations.some((d) => d <= 0)) {
          throw new Error("Crossfades need every clip's duration. Remove and re-add any clip that failed to load.");
        }
        const shortest = Math.min(...durations);
        const d = Math.min(xdur, Math.max(0.1, shortest / 2));
        if (d < xdur) {
          result.warnings.push(`Transition shortened to ${d.toFixed(1)}s to fit the shortest clip.`);
        }
        let vPrev = "v0";
        let aPrev = "a0";
        let elapsed = durations[0]!;
        for (let i = 1; i < clips.length; i++) {
          // Offset is where the outgoing stream should start blending: the
          // running length so far minus one transition.
          const offset = round(elapsed - d, 3);
          const vOut = i === clips.length - 1 ? "outv" : `vx${i}`;
          const aOut = i === clips.length - 1 ? "outa" : `ax${i}`;
          graph.push(
            `[${vPrev}][v${i}]xfade=transition=${transition}:duration=${round(d, 3)}:offset=${offset}[${vOut}]`,
          );
          graph.push(`[${aPrev}][a${i}]acrossfade=d=${round(d, 3)}:c1=tri:c2=tri[${aOut}]`);
          vPrev = vOut;
          aPrev = aOut;
          elapsed = elapsed - d + durations[i]!;
        }
      }

      args.push(
        "-filter_complex",
        graph.join(";"),
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        ...x264(values, 23),
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        out,
      );
      push(`Merging ${clips.length} clips`, args);
      break;
    }

    /* ------------------------------------------------------------ speed */
    case "speed": {
      const rate = Math.max(0.05, num(values.rate, 2));
      if (rate === 1) throw new Error("Pick a playback rate other than 1×.");
      const keepAudio = str(values.audioMode, "pitch") === "pitch" && (info?.hasAudio ?? true);

      if (info && !info.hasVideo) {
        const out = single("mp3", "audio/mpeg", `speed_${rate}x`);
        push("Retiming audio", ["-i", src, "-af", atempoChain(rate), "-c:a", "libmp3lame", "-b:a", "192k", out]);
        break;
      }

      const out = single("mp4", "video/mp4", `speed_${rate}x`);
      const args = ["-i", src];
      if (keepAudio) {
        args.push(
          "-filter_complex",
          `[0:v]setpts=${round(1 / rate, 6)}*PTS[v];[0:a]${atempoChain(rate)}[a]`,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
        );
      } else {
        args.push("-vf", `setpts=${round(1 / rate, 6)}*PTS`, "-an");
      }
      args.push(...x264(values, 23), "-movflags", "+faststart", out);
      push(rate > 1 ? "Speeding up" : "Slowing down", args);
      break;
    }

    /* ------------------------------------------------------------- loop */
    case "loop": {
      const mode = str(values.mode, "boomerang");
      const out = single("mp4", "video/mp4", mode);
      const keepAudio = bool(values.keepAudio) && (info?.hasAudio ?? false);

      if (mode === "repeat") {
        const times = Math.max(2, Math.round(num(values.times, 3)));
        const args = ["-stream_loop", String(times - 1), "-i", src, ...x264(values, 23)];
        args.push(...(keepAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]));
        args.push("-movflags", "+faststart", out);
        push(`Repeating ${times}×`, args);
      } else if (mode === "reverse") {
        const args = ["-i", src, "-vf", "reverse"];
        if (keepAudio) args.push("-af", "areverse", "-c:a", "aac", "-b:a", "160k");
        else args.push("-an");
        args.push(...x264(values, 23), "-movflags", "+faststart", out);
        push("Reversing", args);
      } else {
        push("Building boomerang", [
          "-i",
          src,
          "-filter_complex",
          "[0:v]split[fwd][rev];[rev]reverse[rv];[fwd][rv]concat=n=2:v=1:a=0[v]",
          "-map",
          "[v]",
          "-an",
          ...x264(values, 23),
          "-movflags",
          "+faststart",
          out,
        ]);
      }
      break;
    }

    /* ----------------------------------------------------------- rotate */
    case "rotate": {
      const out = single("mp4", "video/mp4", "rotated");
      const filters: string[] = [];
      switch (str(values.rotation, "90cw")) {
        case "90cw":
          filters.push("transpose=1");
          break;
        case "90ccw":
          filters.push("transpose=2");
          break;
        case "180":
          filters.push("transpose=1", "transpose=1");
          break;
      }
      const flip = str(values.flip, "none");
      if (flip === "h") filters.push("hflip");
      if (flip === "v") filters.push("vflip");
      if (!filters.length) throw new Error("Choose a rotation or a mirror direction.");
      filters.push(EVEN_GUARD);
      push("Rotating", [
        "-i",
        src,
        "-vf",
        filters.join(","),
        ...x264(values, 21),
        ...audioForMp4(info),
        "-movflags",
        "+faststart",
        out,
      ]);
      break;
    }

    /* ---------------------------------------------------- extract-audio */
    case "extract-audio": {
      const fmt = audioFormat(str(values.format, "mp3"));
      const out = single(fmt.ext, fmt.mime, "audio");
      const args: string[] = [];
      if (bool(values.trimRange)) {
        const { start, duration } = timeRange(values, info);
        if (duration <= 0) throw new Error("The end point must come after the start point.");
        args.push("-ss", String(round(start, 3)), "-i", src, "-t", String(round(duration, 3)));
      } else {
        args.push("-i", src);
      }
      args.push("-vn", ...fmt.args(num(values.bitrate, 192)));
      const channels = str(values.channels, "source");
      if (channels !== "source") args.push("-ac", channels);
      args.push(out);
      push(`Extracting ${fmt.label}`, args);
      break;
    }

    /* -------------------------------------------------------- audio-mix */
    case "audio-mix": {
      const track = ctx.extras.track;
      if (!track) throw new Error("Add an audio track first.");
      const out = single("mp4", "video/mp4", "with_audio");
      const duration = info?.durationSec ?? 0;
      let mode = str(values.mode, "replace");
      if (mode === "mix" && !info?.hasAudio) {
        mode = "replace";
        result.warnings.push("This video has no audio track, so the new audio replaces it.");
      }

      const args = ["-i", src];
      if (bool(values.loopTrack)) args.push("-stream_loop", "-1");
      args.push("-i", track.path);

      const fades = buildFades(duration, num(values.fadeIn, 0), num(values.fadeOut, 0), true);
      const trackChain = [`volume=${num(values.trackVolume, 0)}dB`];

      if (mode === "replace") {
        const chain = [...trackChain, ...fades].join(",");
        args.push(
          "-filter_complex",
          `[1:a]${chain}[a]`,
          "-map",
          "0:v",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
        );
      } else {
        const graph =
          `[0:a]volume=${num(values.originalVolume, -12)}dB[a0];` +
          `[1:a]${trackChain.join(",")}[a1];` +
          `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0` +
          (fades.length ? `,${fades.join(",")}` : "") +
          `[a]`;
        args.push(
          "-filter_complex",
          graph,
          "-map",
          "0:v",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
        );
      }
      args.push("-movflags", "+faststart", out);
      push(mode === "mix" ? "Mixing audio" : "Replacing audio", args);
      break;
    }

    /* --------------------------------------------------------- audio-fx */
    case "audio-fx": {
      if (!(info?.hasAudio ?? true)) throw new Error("This file has no audio track to work on.");
      const chain: string[] = [];
      if (bool(values.denoise)) chain.push("afftdn=nr=12:nf=-25");
      const gain = num(values.gain, 0);
      if (gain !== 0) chain.push(`volume=${gain}dB`);
      if (bool(values.normalize)) chain.push("loudnorm=I=-16:TP=-1.5:LRA=11");
      chain.push(...buildFades(info?.durationSec ?? 0, num(values.fadeIn, 0), num(values.fadeOut, 0), true));
      if (!chain.length) throw new Error("Turn on at least one audio effect.");

      const output = str(values.output, "same");
      if (output === "same") {
        const ext = info?.hasVideo ? "mp4" : "m4a";
        const out = single(ext, info?.hasVideo ? "video/mp4" : "audio/mp4", "audio_cleaned");
        const args = ["-i", src, "-af", chain.join(",")];
        if (info?.hasVideo) args.push("-c:v", "copy");
        args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
        push("Processing audio", args);
      } else {
        const fmt = audioFormat(output);
        const out = single(fmt.ext, fmt.mime, "audio_cleaned");
        push("Processing audio", ["-i", src, "-vn", "-af", chain.join(","), ...fmt.args(192), out]);
      }
      break;
    }

    /* -------------------------------------------------------------- gif */
    case "gif": {
      const { start, duration } = timeRange(values, info);
      if (duration <= 0) throw new Error("The end point must come after the start point.");
      const fps = num(values.fps, 15);
      const widthValue = str(values.width, "480");
      const scale = widthValue === "source" ? "" : `,scale=${widthValue}:-1:flags=lanczos`;
      const seek = ["-ss", String(round(start, 3)), "-t", String(round(duration, 3))];

      if (str(values.format, "gif") === "webp") {
        const out = single("webp", "image/webp", "animation");
        push("Rendering WebP", [
          ...seek,
          "-i",
          src,
          "-vf",
          `fps=${fps}${scale}`,
          "-loop",
          "0",
          "-q:v",
          String(num(values.quality, 75)),
          "-an",
          out,
        ]);
      } else {
        const out = single("gif", "image/gif", "animation");
        const palette = `${OUT_DIR}/palette.png`;
        const colors = num(values.colors, 256);
        const ditherValue = str(values.dither, "bayer");
        const dither = ditherValue === "bayer" ? "bayer:bayer_scale=3" : ditherValue;
        push(
          "Building colour palette",
          [
            ...seek,
            "-i",
            src,
            "-vf",
            `fps=${fps}${scale},palettegen=max_colors=${colors}:stats_mode=diff`,
            palette,
          ],
          0.4,
        );
        push(
          "Rendering GIF",
          [
            ...seek,
            "-i",
            src,
            "-i",
            palette,
            "-filter_complex",
            `[0:v]fps=${fps}${scale}[x];[x][1:v]paletteuse=dither=${dither}[o]`,
            "-map",
            "[o]",
            "-loop",
            "0",
            out,
          ],
          1.6,
        );
      }
      break;
    }

    /* -------------------------------------------------------- thumbnail */
    case "thumbnail": {
      const format = str(values.format, "jpg");
      const mime = format === "png" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
      const out = single(format, mime, "thumbnail");
      const widthValue = str(values.width, "source");
      const filters: string[] = [];
      const args: string[] = [];

      if (str(values.pick, "at") === "smart") {
        filters.push("thumbnail=300");
        args.push("-i", src);
      } else {
        args.push("-ss", String(round(num(values.start, 0), 3)), "-i", src);
      }
      if (widthValue !== "source") filters.push(`scale=${widthValue}:-2:flags=lanczos`);
      if (filters.length) args.push("-vf", filters.join(","));
      args.push("-frames:v", "1");
      const q = num(values.quality, 3);
      if (format === "jpg") args.push("-q:v", String(q));
      if (format === "webp") args.push("-quality", String(Math.max(20, 105 - q * 5)));
      args.push(out);
      push("Grabbing frame", args);
      break;
    }

    /* ----------------------------------------------------------- frames */
    case "frames": {
      const { start, duration } = timeRange(values, info);
      if (duration <= 0) throw new Error("The end point must come after the start point.");
      const format = str(values.format, "jpg");
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const rate = str(values.rate, "1");
      const limit = Math.max(1, Math.round(num(values.limit, 120)));
      const filters: string[] = [];
      if (rate !== "source") filters.push(`fps=${rate}`);
      const widthValue = str(values.width, "source");
      if (widthValue !== "source") filters.push(`scale=${widthValue}:-2:flags=lanczos`);

      result.mkdirs.push(FRAMES_DIR);
      const args = ["-ss", String(round(start, 3)), "-i", src, "-t", String(round(duration, 3))];
      if (filters.length) args.push("-vf", filters.join(","));
      args.push("-frames:v", String(limit));
      if (format === "jpg") args.push("-q:v", "3");
      args.push(`${FRAMES_DIR}/frame_%04d.${format}`);
      push("Exporting frames", args);
      result.outputs.push({ kind: "sequence", dir: FRAMES_DIR, prefix: "frame_", ext: format, mime });

      const expected = rate === "source" ? Math.round((info?.fps ?? 30) * duration) : Number(rate) * duration;
      if (expected > limit) {
        result.warnings.push(`That range would yield about ${Math.round(expected)} frames — capped at ${limit}.`);
      }
      break;
    }

    /* -------------------------------------------------------- watermark */
    case "watermark": {
      const out = single("mp4", "video/mp4", "watermarked");
      const opacity = Math.min(1, Math.max(0, num(values.opacity, 85) / 100));
      const margin = num(values.margin, 24);
      const position = str(values.position, "bottom-right");
      const baseWidth = info?.width || 1920;
      const baseHeight = info?.height || 1080;

      if (str(values.kind, "text") === "text") {
        if (!ctx.fontDir || !ctx.fontName) {
          throw new Error("Upload a .ttf or .otf font file to render text overlays.");
        }
        const text = str(values.text, "").trim();
        if (!text) throw new Error("Enter the watermark text.");
        // Written to a file so the text never has to survive filtergraph escaping.
        const textPath = `${TEXT_DIR}/watermark.txt`;
        result.mkdirs.push(TEXT_DIR);
        result.writes.push({ path: textPath, content: text });

        const fontPx = Math.max(8, Math.round((baseHeight * num(values.fontSize, 4)) / 100));
        const pos = textPosition(position, margin);
        const parts = [
          `drawtext=fontfile=${ctx.fontDir}/${ctx.fontName}`,
          `textfile=${textPath}`,
          "expansion=none",
          `fontsize=${fontPx}`,
          `fontcolor=${hexToFfmpegColor(str(values.color, "#ffffff"))}@${round(opacity, 2)}`,
          `x=${pos.x}`,
          `y=${pos.y}`,
        ];
        const backdrop = str(values.backdrop, "shadow");
        if (backdrop === "shadow") {
          parts.push("shadowcolor=black@0.6", "shadowx=2", "shadowy=2");
        } else if (backdrop === "box") {
          parts.push("box=1", "boxcolor=black@0.45", `boxborderw=${Math.round(fontPx / 3)}`);
        }
        push("Adding text watermark", [
          "-i",
          src,
          "-vf",
          `${parts.join(":")},${EVEN_GUARD}`,
          ...x264(values, 21),
          ...audioForMp4(info),
          "-movflags",
          "+faststart",
          out,
        ]);
      } else {
        const logo = ctx.extras.logo;
        if (!logo) throw new Error("Add a logo image first.");
        const logoWidth = Math.max(8, Math.round((baseWidth * num(values.scale, 15)) / 100));
        const pos = overlayPosition(position, margin);
        push("Adding logo watermark", [
          "-i",
          src,
          "-i",
          logo.path,
          "-filter_complex",
          `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${round(opacity, 2)}[wm];` +
            `[0:v][wm]overlay=${pos.x}:${pos.y},${EVEN_GUARD}[v]`,
          "-map",
          "[v]",
          "-map",
          "0:a?",
          ...x264(values, 21),
          ...audioForMp4(info),
          "-movflags",
          "+faststart",
          out,
        ]);
      }
      break;
    }

    /* -------------------------------------------------------- subtitles */
    case "subtitles": {
      const subs = ctx.extras.subs;
      if (!subs) throw new Error("Add a caption file first.");
      if (!ctx.fontDir || !ctx.fontName) {
        throw new Error("Upload a .ttf or .otf font file — the bundled ffmpeg ships without fonts.");
      }
      const out = single("mp4", "video/mp4", "captioned");
      const alignment = { bottom: 2, middle: 5, top: 8 }[str(values.position, "bottom")] ?? 2;
      const style = [
        `FontName=${ctx.fontFamily ?? "Sans"}`,
        `FontSize=${num(values.fontSize, 24)}`,
        `PrimaryColour=${hexToAssColor(str(values.color, "#ffffff"))}`,
        `OutlineColour=${hexToAssColor(str(values.outlineColor, "#000000"))}`,
        `BackColour=${hexToAssColor("#000000", 0x60)}`,
        `BorderStyle=${bool(values.shadowBox) ? 4 : 1}`,
        `Outline=${num(values.outline, 2)}`,
        "Shadow=0",
        `Bold=${bool(values.bold) ? -1 : 0}`,
        `Alignment=${alignment}`,
        `MarginV=${num(values.marginV, 30)}`,
      ].join(",");

      push("Burning captions", [
        "-i",
        src,
        "-vf",
        `subtitles=${subs.path}:fontsdir=${ctx.fontDir}:force_style='${style}',${EVEN_GUARD}`,
        ...x264(values, 21),
        ...audioForMp4(info),
        "-movflags",
        "+faststart",
        out,
      ]);
      break;
    }

    /* ------------------------------------------------------------ color */
    case "color": {
      const out = single("mp4", "video/mp4", "graded");
      const filters: string[] = [];
      const look = str(values.look, "none");
      const lookChain = LOOKS[look];
      if (lookChain) filters.push(...lookChain);

      const eq: string[] = [];
      const brightness = num(values.brightness, 0);
      const contrast = num(values.contrast, 1);
      const saturation = num(values.saturation, 1);
      const gamma = num(values.gamma, 1);
      if (brightness !== 0) eq.push(`brightness=${round(brightness, 3)}`);
      if (contrast !== 1) eq.push(`contrast=${round(contrast, 3)}`);
      if (saturation !== 1) eq.push(`saturation=${round(saturation, 3)}`);
      if (gamma !== 1) eq.push(`gamma=${round(gamma, 3)}`);
      if (eq.length) filters.push(`eq=${eq.join(":")}`);

      const sharpen = num(values.sharpen, 0);
      if (sharpen > 0) filters.push(`unsharp=5:5:${round(sharpen, 2)}:5:5:0`);
      const blur = num(values.blur, 0);
      if (blur > 0) filters.push(`boxblur=${Math.round(blur)}:1`);
      const vignette = num(values.vignette, 0);
      if (vignette > 0) {
        // PI/5 is a subtle falloff, PI/2.2 is heavy — map the slider between them.
        const angle = round(Math.PI / 5 + (vignette / 100) * (Math.PI / 2.2 - Math.PI / 5), 4);
        filters.push(`vignette=angle=${angle}`);
      }
      if (!filters.length) throw new Error("Pick a look or move at least one slider.");
      filters.push(EVEN_GUARD);

      push("Grading", [
        "-i",
        src,
        "-vf",
        filters.join(","),
        ...x264(values, 21),
        ...audioForMp4(info),
        "-movflags",
        "+faststart",
        out,
      ]);
      break;
    }

    /* --------------------------------------------------------- waveform */
    case "waveform": {
      if (!(info?.hasAudio ?? true)) throw new Error("This file has no audio to visualise.");
      const { width, height } = resolveFrameSize(values);
      const out = single("mp4", "video/mp4", "audiogram");
      const waveHeight = even((height * num(values.waveHeight, 40)) / 100);
      const range = bool(values.trimRange) ? timeRange(values, info) : null;
      if (range && range.duration <= 0) throw new Error("The end point must come after the start point.");
      const duration = range ? range.duration : info?.durationSec ?? 0;

      const args: string[] = [];
      if (range) args.push("-ss", String(round(range.start, 3)));
      args.push("-i", src);
      if (range) args.push("-t", String(round(range.duration, 3)));

      // Two things matter here. First, the audio must reach both the waveform
      // renderer and the output, and a single input stream cannot feed a
      // filtergraph and an output map at once — ffmpeg accepts that and then
      // deadlocks — so it is split and both branches leave via the graph.
      // Second, the backdrop is produced with `pad` rather than a `color`
      // source composited by `overlay`: `color` never ends, and relying on
      // `shortest` to stop it is far more fragile than a chain that simply
      // terminates when the audio does.
      const graph =
        `[0:a]asplit=2[awave][aout];` +
        `[awave]showwaves=s=${width}x${waveHeight}:mode=${str(values.style, "line")}:` +
        `rate=25:colors=${hexToFfmpegColor(str(values.waveColor, "#7c5cff"))}[wave];` +
        `[wave]pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:` +
        `color=${hexToFfmpegColor(str(values.bgColor, "#0b0b12"))},format=yuv420p[v]`;

      args.push(
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-map",
        "[aout]",
        ...x264(values, 23),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      );
      if (duration > 0) args.push("-t", String(round(duration, 3)));
      args.push("-movflags", "+faststart", out);
      push("Rendering audiogram", args);
      break;
    }

    default: {
      const exhaustive: never = ctx.tool;
      throw new Error(`Unknown tool: ${String(exhaustive)}`);
    }
  }

  return result;
}

/** Shared afade pair. Returns an empty list when both durations are zero. */
function buildFades(duration: number, fadeIn: number, fadeOut: number, audio: boolean): string[] {
  const prefix = audio ? "afade" : "fade";
  const out: string[] = [];
  if (fadeIn > 0) out.push(`${prefix}=t=in:st=0:d=${round(fadeIn, 3)}`);
  if (fadeOut > 0 && duration > fadeOut) {
    out.push(`${prefix}=t=out:st=${round(duration - fadeOut, 3)}:d=${round(fadeOut, 3)}`);
  }
  return out;
}

/** Filter chains for the one-click looks in the colour tool. */
const LOOKS: Record<string, string[] | undefined> = {
  warm: ["colorbalance=rs=0.08:gs=0.02:bs=-0.09", "eq=saturation=1.1"],
  cool: ["colorbalance=rs=-0.08:gs=0.01:bs=0.11", "eq=saturation=1.05"],
  cinematic: [
    "colorbalance=rs=0.1:bs=-0.06:rm=-0.04:bm=0.06:rh=-0.06:bh=0.12",
    "eq=contrast=1.15:saturation=0.95",
  ],
  vivid: ["eq=contrast=1.15:saturation=1.5"],
  bw: ["hue=s=0", "eq=contrast=1.12"],
  vintage: ["colorbalance=rs=0.12:gs=0.04:bs=-0.12", "eq=saturation=0.72:contrast=0.92", "vignette=angle=PI/4"],
};

export type { BuildContext, BuildInput, BuiltCommand };
