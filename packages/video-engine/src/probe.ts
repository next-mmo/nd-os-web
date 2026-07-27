import type { MediaInfo } from "./types";

/**
 * ffmpeg.wasm gives us no ffprobe, so media details are scraped from the log
 * ffmpeg prints while opening the input. Running `ffmpeg -i file` with no
 * output is enough — it prints the stream table and then exits with an error,
 * which the caller is expected to ignore.
 */

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const BITRATE_RE = /bitrate:\s*(\d+)\s*kb\/s/;
const VIDEO_RE = /Stream #\d+:\d+.*?:\s*Video:\s*([\w-]+)/;
const AUDIO_RE = /Stream #\d+:\d+.*?:\s*Audio:\s*([\w-]+)/;
const DIMS_RE = /\b(\d{2,5})x(\d{2,5})\b/;
const FPS_RE = /(\d+(?:\.\d+)?)\s*fps\b/;
const HZ_RE = /(\d+)\s*Hz\b/;
const CHANNELS_RE = /\b(mono|stereo|(\d+)\schannels)\b/;

export const EMPTY_INFO: Omit<MediaInfo, "name" | "sizeBytes"> = {
  durationSec: 0,
  hasVideo: false,
  hasAudio: false,
  width: 0,
  height: 0,
  fps: 0,
  videoCodec: null,
  audioCodec: null,
  bitrateKbps: null,
  sampleRate: null,
  channels: null,
};

export function parseMediaInfo(log: string, name: string, sizeBytes: number): MediaInfo {
  const info: MediaInfo = { ...EMPTY_INFO, name, sizeBytes };
  const lines = log.split("\n");

  for (const line of lines) {
    const duration = DURATION_RE.exec(line);
    if (duration && info.durationSec === 0) {
      info.durationSec =
        Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      const bitrate = BITRATE_RE.exec(line);
      if (bitrate) info.bitrateKbps = Number(bitrate[1]);
    }

    const video = VIDEO_RE.exec(line);
    if (video && !info.hasVideo) {
      info.hasVideo = true;
      info.videoCodec = video[1]!.toLowerCase();
      // Trim the display-aspect note first so its numbers can't be mistaken
      // for the coded frame size.
      const dims = DIMS_RE.exec(line.replace(/\[[^\]]*\]/g, ""));
      if (dims) {
        info.width = Number(dims[1]);
        info.height = Number(dims[2]);
      }
      const fps = FPS_RE.exec(line);
      if (fps) info.fps = Number(fps[1]);
    }

    const audio = AUDIO_RE.exec(line);
    if (audio && !info.hasAudio) {
      info.hasAudio = true;
      info.audioCodec = audio[1]!.toLowerCase();
      const hz = HZ_RE.exec(line);
      if (hz) info.sampleRate = Number(hz[1]);
      const ch = CHANNELS_RE.exec(line);
      if (ch) info.channels = ch[1] === "mono" ? 1 : ch[1] === "stereo" ? 2 : Number(ch[2]);
    }
  }

  return info;
}

/** Pulls the elapsed output timestamp out of an ffmpeg status line. */
export function parseProgressTime(line: string): number | null {
  const m = /time=\s*(-)?(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  // ffmpeg prints `-00:00:00.02` before the first frame is written; the sign
  // lives outside the hours field, so it has to be checked on its own.
  if (m[1]) return 0;
  return Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * ffmpeg reports failures across several lines; this picks the one worth
 * showing a person instead of dumping the whole log.
 */
export function extractError(log: string): string | null {
  const lines = log.split("\n").map((l) => l.trim()).filter(Boolean);
  const patterns = [
    /^\[.*?\]\s*(.*(?:not found|no such|invalid|unable|failed|error).*)$/i,
    /^(Error .*)$/i,
    /^(Unknown .*)$/i,
    /^(No such file.*)$/i,
    /^(Invalid .*)$/i,
    /^(Conversion failed.*)$/i,
    /^(.*Invalid argument.*)$/i,
    /^(.*does not contain any stream.*)$/i,
  ];
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const pattern of patterns) {
      const m = pattern.exec(lines[i]!);
      if (m) return m[1]!.trim();
    }
  }
  return null;
}
