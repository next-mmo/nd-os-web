import { describe, expect, it } from "vitest";
import {
  atempoChain,
  buildCommand,
  downscaleFilter,
  hexToAssColor,
  hexToFfmpegColor,
  timeRange,
} from "./commands";
import { parseMediaInfo, parseProgressTime } from "./probe";
import { defaultValues, TOOLS, TOOL_IDS } from "./tools";
import type { BuildContext, MediaInfo, ToolId } from "./types";

const videoInfo = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  name: "clip.mp4",
  sizeBytes: 10_000_000,
  durationSec: 30,
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264",
  audioCodec: "aac",
  bitrateKbps: 2500,
  sampleRate: 48000,
  channels: 2,
  ...overrides,
});

function ctx(tool: ToolId, values: Record<string, unknown> = {}, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    tool,
    values: { ...defaultValues(tool), ...values } as BuildContext["values"],
    source: { path: "src", info: videoInfo() },
    extras: {},
    ...overrides,
  };
}

/** Reads the value that follows a flag, so tests do not depend on arg order. */
function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("helpers", () => {
  it("decomposes speed changes into in-range atempo steps", () => {
    expect(atempoChain(2)).toBe("atempo=2");
    expect(atempoChain(4)).toBe("atempo=2,atempo=2");
    expect(atempoChain(8)).toBe("atempo=2,atempo=2,atempo=2");
    expect(atempoChain(0.25)).toBe("atempo=0.5,atempo=0.5");
    // Every chain must multiply back out to the requested rate.
    for (const rate of [0.25, 0.5, 0.75, 1.5, 3, 5, 8]) {
      const product = atempoChain(rate)
        .split(",")
        .reduce((acc, part) => acc * Number(part.split("=")[1]), 1);
      expect(product).toBeCloseTo(rate, 5);
    }
  });

  it("scales the short edge and never upscales", () => {
    expect(downscaleFilter(videoInfo(), 720)).toBe("scale=-2:720");
    // Vertical footage: 720p means 720 across, not 720 tall.
    expect(downscaleFilter(videoInfo({ width: 1080, height: 1920 }), 720)).toBe("scale=720:-2");
    expect(downscaleFilter(videoInfo({ width: 640, height: 360 }), 720)).toBeNull();
  });

  it("converts colours for filters and for ASS styling", () => {
    expect(hexToFfmpegColor("#7C5CFF")).toBe("0x7C5CFF");
    // ASS stores BGR, not RGB.
    expect(hexToAssColor("#ff0000")).toBe("&H000000FF");
    expect(hexToAssColor("#0000ff")).toBe("&H00FF0000");
  });

  it("treats a zero end time as the end of the clip", () => {
    const info = videoInfo({ durationSec: 42 });
    expect(timeRange({ start: 5, end: 0 }, info)).toEqual({ start: 5, end: 42, duration: 37 });
    expect(timeRange({ start: 0, end: 100 }, info).end).toBe(42);
  });
});

describe("probe", () => {
  const log = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'src':
  Duration: 00:01:05.20, start: 0.000000, bitrate: 2500 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 2400 kb/s, 30 fps, 30 tbr, 15360 tbn
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
`;

  it("reads duration, streams and geometry out of the ffmpeg banner", () => {
    const info = parseMediaInfo(log, "clip.mp4", 1234);
    expect(info.durationSec).toBeCloseTo(65.2, 2);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.fps).toBe(30);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(info.channels).toBe(2);
    expect(info.sampleRate).toBe(48000);
  });

  it("does not mistake the display-aspect note for the frame size", () => {
    const info = parseMediaInfo(log, "clip.mp4", 0);
    expect(info.width).not.toBe(16);
  });

  it("reads audio-only files", () => {
    const audioLog = `
Input #0, mp3, from 'src':
  Duration: 00:03:12.00, start: 0.000000, bitrate: 192 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 192 kb/s
`;
    const info = parseMediaInfo(audioLog, "song.mp3", 0);
    expect(info.hasVideo).toBe(false);
    expect(info.hasAudio).toBe(true);
    expect(info.channels).toBe(1);
    expect(info.durationSec).toBe(192);
  });

  it("pulls elapsed time out of a status line", () => {
    expect(parseProgressTime("frame=  120 fps=30 q=28.0 size=1024kB time=00:00:04.50 bitrate=1")).toBeCloseTo(4.5);
    // ffmpeg emits a negative placeholder before the first frame lands.
    expect(parseProgressTime("time=-00:00:00.02")).toBe(0);
    expect(parseProgressTime("no timestamp here")).toBeNull();
  });
});

describe("buildCommand", () => {
  it("produces a runnable plan with defaults for every tool", () => {
    // A few tools are deliberately inert until the user picks something; give
    // them the minimum nudge so the smoke test still covers their arg shapes.
    const seeds: Partial<Record<ToolId, Record<string, unknown>>> = {
      color: { look: "cinematic" },
    };
    for (const id of TOOL_IDS) {
      const spec = TOOLS[id];
      const overrides: Partial<BuildContext> = {
        extras: {},
        fontDir: "fonts",
        fontName: "f.ttf",
        fontFamily: "Inter",
      };
      for (const extra of spec.extras ?? []) {
        overrides.extras![extra.id] = { path: `extra_${extra.id}`, info: videoInfo() };
      }
      if (spec.multiClip) {
        overrides.clips = [
          { path: "clip0", info: videoInfo({ durationSec: 10 }) },
          { path: "clip1", info: videoInfo({ durationSec: 8 }) },
        ];
      }
      const built = buildCommand(ctx(id, seeds[id] ?? {}, overrides));
      expect(built.steps.length, `${id} produced no steps`).toBeGreaterThan(0);
      expect(built.outputs.length, `${id} produced no outputs`).toBeGreaterThan(0);
      for (const step of built.steps) {
        expect(step.args, `${id} step has no input`).toContain("-i");
      }
    }
  });

  it("keeps -ss before -i so seeking is fast", () => {
    const built = buildCommand(ctx("trim", { start: 12, end: 20 }));
    const args = built.steps[0]!.args;
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(argAfter(args, "-ss")).toBe("12");
    expect(argAfter(args, "-t")).toBe("8");
  });

  it("rejects a trim range that ends before it starts", () => {
    expect(() => buildCommand(ctx("trim", { start: 20, end: 5 }))).toThrow(/end point/i);
  });

  it("uses stream copy for instant trims", () => {
    const args = buildCommand(ctx("trim", { start: 1, end: 5, accuracy: "fast" })).steps[0]!.args;
    expect(args).toContain("copy");
    expect(args).not.toContain("libx264");
  });

  it("runs two passes and lands under the size target", () => {
    const built = buildCommand(ctx("compress", { mode: "size", targetMb: 8, audioKbps: 96 }));
    expect(built.steps).toHaveLength(2);
    expect(built.steps[0]!.args).toContain("1");
    expect(argAfter(built.steps[0]!.args, "-pass")).toBe("1");
    expect(argAfter(built.steps[1]!.args, "-pass")).toBe("2");
    // Pass one must not waste time encoding audio.
    expect(built.steps[0]!.args).toContain("-an");

    const videoKbps = Number(argAfter(built.steps[1]!.args, "-b:v")!.replace("k", ""));
    const projectedMb = ((videoKbps + 96) * 30) / 8 / 1024;
    expect(projectedMb).toBeLessThanOrEqual(8);
    expect(projectedMb).toBeGreaterThan(7);
  });

  it("refuses a size target that cannot fit", () => {
    // A 10-minute clip has no chance of reaching 1 MB once audio is paid for.
    const longClip = { path: "src", info: videoInfo({ durationSec: 600 }) };
    expect(() =>
      buildCommand(ctx("compress", { mode: "size", targetMb: 1 }, { source: longClip })),
    ).toThrow(/too small/i);
  });

  it("needs a known duration before it can hit a size target", () => {
    const unknown = { path: "src", info: videoInfo({ durationSec: 0 }) };
    expect(() =>
      buildCommand(ctx("compress", { mode: "size", targetMb: 8 }, { source: unknown })),
    ).toThrow(/duration/i);
  });

  it("offsets crossfades by the running length minus one transition", () => {
    const clips = [
      { path: "c0", info: videoInfo({ durationSec: 10 }) },
      { path: "c1", info: videoInfo({ durationSec: 8 }) },
      { path: "c2", info: videoInfo({ durationSec: 6 }) },
    ];
    const built = buildCommand(ctx("merge", { transition: "fade", transitionSec: 1 }, { clips }));
    const graph = argAfter(built.steps[0]!.args, "-filter_complex")!;
    // First blend starts 1s before clip 0 ends; the second starts 1s before the
    // 17s-long combined stream ends.
    expect(graph).toContain("xfade=transition=fade:duration=1:offset=9");
    expect(graph).toContain("xfade=transition=fade:duration=1:offset=16");
    expect(graph).toContain("[outv]");
    expect(graph).toContain("[outa]");
  });

  it("shortens a transition that will not fit the shortest clip", () => {
    const clips = [
      { path: "c0", info: videoInfo({ durationSec: 10 }) },
      { path: "c1", info: videoInfo({ durationSec: 1 }) },
    ];
    const built = buildCommand(ctx("merge", { transition: "fade", transitionSec: 3 }, { clips }));
    expect(built.warnings.join(" ")).toMatch(/shortened/i);
    expect(argAfter(built.steps[0]!.args, "-filter_complex")).toContain("duration=0.5");
  });

  it("substitutes silence for clips that have no audio track", () => {
    const clips = [
      { path: "c0", info: videoInfo({ durationSec: 5, hasAudio: false }) },
      { path: "c1", info: videoInfo({ durationSec: 5 }) },
    ];
    const args = buildCommand(ctx("merge", {}, { clips })).steps[0]!.args;
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    // The silent clip's audio must come from the generated input, not itself.
    expect(argAfter(args, "-filter_complex")).toContain("[2:a]aresample");
  });

  it("needs at least two clips", () => {
    expect(() => buildCommand(ctx("merge", {}, { clips: [{ path: "c0", info: videoInfo() }] }))).toThrow(
      /at least two/i,
    );
  });

  it("builds a two-pass palette for GIFs", () => {
    const built = buildCommand(ctx("gif", { start: 0, end: 3, format: "gif" }));
    expect(built.steps).toHaveLength(2);
    expect(built.steps[0]!.args.join(" ")).toContain("palettegen=max_colors=256:stats_mode=diff");
    expect(built.steps[1]!.args.join(" ")).toContain("paletteuse=dither=bayer:bayer_scale=3");
  });

  it("writes watermark text to a file instead of into the filtergraph", () => {
    const built = buildCommand(
      ctx("watermark", { kind: "text", text: "it's 100% mine: @me" }, { fontDir: "fonts", fontName: "f.ttf" }),
    );
    expect(built.writes).toEqual([{ path: "text/watermark.txt", content: "it's 100% mine: @me" }]);
    const vf = argAfter(built.steps[0]!.args, "-vf")!;
    expect(vf).toContain("textfile=text/watermark.txt");
    expect(vf).not.toContain("@me");
  });

  it("sizes text as a share of frame height", () => {
    const built = buildCommand(
      ctx("watermark", { kind: "text", fontSize: 10 }, { fontDir: "fonts", fontName: "f.ttf" }),
    );
    // 10% of a 1080-tall frame.
    expect(argAfter(built.steps[0]!.args, "-vf")).toContain("fontsize=108");
  });

  it("requires a font before rendering text or captions", () => {
    expect(() => buildCommand(ctx("watermark", { kind: "text" }))).toThrow(/font/i);
    expect(() =>
      buildCommand(ctx("subtitles", {}, { extras: { subs: { path: "subs.srt", info: null } } })),
    ).toThrow(/font/i);
  });

  it("quotes force_style so its commas survive the filtergraph parser", () => {
    const built = buildCommand(
      ctx("subtitles", { fontSize: 30 }, {
        extras: { subs: { path: "subs.srt", info: null } },
        fontDir: "fonts",
        fontName: "f.ttf",
        fontFamily: "Inter Tight",
      }),
    );
    const vf = argAfter(built.steps[0]!.args, "-vf")!;
    expect(vf).toContain("force_style='");
    expect(vf).toContain("FontName=Inter Tight");
    expect(vf).toContain("fontsdir=fonts");
    expect(/force_style='[^']*'/.test(vf)).toBe(true);
  });

  it("falls back to replacing audio when the video is silent", () => {
    const built = buildCommand(
      ctx("audio-mix", { mode: "mix" }, {
        source: { path: "src", info: videoInfo({ hasAudio: false }) },
        extras: { track: { path: "track.mp3", info: null } },
      }),
    );
    expect(built.warnings.join(" ")).toMatch(/no audio/i);
    expect(argAfter(built.steps[0]!.args, "-filter_complex")).not.toContain("amix");
  });

  it("keeps original audio unmixed at the requested level", () => {
    const built = buildCommand(
      ctx("audio-mix", { mode: "mix", originalVolume: -18, trackVolume: 3 }, {
        extras: { track: { path: "track.mp3", info: null } },
      }),
    );
    const graph = argAfter(built.steps[0]!.args, "-filter_complex")!;
    expect(graph).toContain("volume=-18dB");
    expect(graph).toContain("volume=3dB");
    // normalize=0 stops amix from halving both inputs.
    expect(graph).toContain("normalize=0");
  });

  it("transcodes non-AAC audio when muxing to MP4", () => {
    const opus = buildCommand(
      ctx("rotate", {}, { source: { path: "src", info: videoInfo({ audioCodec: "opus" }) } }),
    ).steps[0]!.args;
    expect(argAfter(opus, "-c:a")).toBe("aac");

    const aac = buildCommand(ctx("rotate")).steps[0]!.args;
    expect(argAfter(aac, "-c:a")).toBe("copy");

    const silent = buildCommand(
      ctx("rotate", {}, { source: { path: "src", info: videoInfo({ hasAudio: false }) } }),
    ).steps[0]!.args;
    expect(silent).toContain("-an");
  });

  it("keeps even dimensions for filters that preserve the source size", () => {
    for (const tool of ["rotate", "color"] as ToolId[]) {
      const built = buildCommand(ctx(tool, tool === "color" ? { look: "vivid" } : {}));
      expect(argAfter(built.steps[0]!.args, "-vf")).toContain("pad=ceil(iw/2)*2:ceil(ih/2)*2");
    }
  });

  it("inverts the playback rate for setpts", () => {
    // Twice as fast means each frame's timestamp is halved.
    expect(argAfter(buildCommand(ctx("speed", { rate: 2 })).steps[0]!.args, "-filter_complex")).toContain(
      "setpts=0.5*PTS",
    );
    expect(argAfter(buildCommand(ctx("speed", { rate: 0.5 })).steps[0]!.args, "-filter_complex")).toContain(
      "setpts=2*PTS",
    );
  });

  it("rejects a no-op speed change", () => {
    expect(() => buildCommand(ctx("speed", { rate: 1 }))).toThrow(/other than 1/i);
  });

  it("caps frame exports and says so", () => {
    const built = buildCommand(ctx("frames", { start: 0, end: 30, rate: "5", limit: 20 }));
    expect(argAfter(built.steps[0]!.args, "-frames:v")).toBe("20");
    expect(built.warnings.join(" ")).toMatch(/capped at 20/);
    expect(built.mkdirs).toContain("frames");
    expect(built.outputs[0]).toMatchObject({ kind: "sequence", dir: "frames", ext: "jpg" });
  });

  it("never feeds one input stream to both the filtergraph and an output map", () => {
    // ffmpeg accepts that shape and then deadlocks, so no builder may emit it.
    for (const id of TOOL_IDS) {
      const spec = TOOLS[id];
      const overrides: Partial<BuildContext> = {
        extras: {},
        fontDir: "fonts",
        fontName: "f.ttf",
        fontFamily: "Inter",
      };
      for (const extra of spec.extras ?? []) {
        overrides.extras![extra.id] = { path: `extra_${extra.id}`, info: videoInfo() };
      }
      if (spec.multiClip) {
        overrides.clips = [
          { path: "clip0", info: videoInfo({ durationSec: 10 }) },
          { path: "clip1", info: videoInfo({ durationSec: 8 }) },
        ];
      }
      const seeds: Partial<Record<ToolId, Record<string, unknown>>> = { color: { look: "cinematic" } };
      for (const step of buildCommand(ctx(id, seeds[id] ?? {}, overrides)).steps) {
        const graph = argAfter(step.args, "-filter_complex");
        if (!graph) continue;
        const consumed = new Set([...graph.matchAll(/\[(\d+):([va])\??\]/g)].map((m) => `${m[1]}:${m[2]}`));
        const mapped = step.args
          .map((arg, i) => (step.args[i - 1] === "-map" ? arg : null))
          .filter((arg): arg is string => arg !== null && /^\d+:[va]\??$/.test(arg))
          .map((arg) => arg.replace("?", ""));
        for (const target of mapped) {
          expect(consumed.has(target), `${id} maps ${target} that its filtergraph already consumes`).toBe(false);
        }
      }
    }
  });

  it("does not scale when the source is already small enough", () => {
    const built = buildCommand(
      ctx("convert", { scaleTo: "1080" }, { source: { path: "src", info: videoInfo({ width: 640, height: 360 }) } }),
    );
    expect(built.steps[0]!.args).not.toContain("-vf");
    expect(built.warnings.join(" ")).toMatch(/already/i);
  });

  it("blurs a backdrop instead of cropping when asked", () => {
    const built = buildCommand(ctx("resize", { preset: "vertical-1080", fit: "blur" }));
    const graph = argAfter(built.steps[0]!.args, "-filter_complex")!;
    expect(graph).toContain("boxblur=20:2");
    expect(graph).toContain("crop=1080:1920");
    expect(graph).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("honours a custom canvas size and forces even dimensions", () => {
    const built = buildCommand(ctx("resize", { preset: "custom", width: 801, height: 603, fit: "stretch" }));
    expect(argAfter(built.steps[0]!.args, "-vf")).toContain("scale=802:604");
  });
});
