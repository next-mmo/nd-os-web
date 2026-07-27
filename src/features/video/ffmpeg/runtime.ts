import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  extractError,
  parseMediaInfo,
  parseProgressTime,
  type BuiltCommand,
  type MediaInfo,
} from "@nd-os/video-engine";

/** Inputs beyond this are likely to exhaust the WASM heap mid-encode. */
export const LARGE_INPUT_WARN_BYTES = 400 * 1024 * 1024;

export class RuntimeUnavailableError extends Error {}
export class JobCancelledError extends Error {
  constructor() {
    super("Cancelled");
  }
}

export type RunOptions = {
  /** Output length in seconds, used to turn ffmpeg's `time=` into a percentage. */
  expectedDuration: number;
  onProgress?: (fraction: number, stepLabel: string) => void;
  onLog?: (line: string) => void;
};

export type RunResult = {
  artifacts: { name: string; mime: string; blob: Blob }[];
  log: string[];
};

/**
 * The core is staged into `public/ffmpeg/` by scripts/sync-ffmpeg-core.mjs so
 * it is served verbatim — routing the emscripten loader through Vite's JS
 * transform injects the HMR client, which touches `document` and therefore
 * throws inside the worker.
 *
 * The URLs must be absolute: `base` is "./" in this project, but the ffmpeg
 * worker resolves them against its own location rather than the document's.
 */
function coreAsset(name: string): string {
  const base = new URL(import.meta.env.BASE_URL || "./", document.baseURI);
  return new URL(`ffmpeg/${name}`, base).href;
}

class VideoRuntime {
  #ffmpeg: FFmpeg | null = null;
  #loading: Promise<FFmpeg> | null = null;
  #log: string[] = [];
  #onLine: ((line: string) => void) | null = null;
  #cancelled = false;
  #generation = 0;

  get loaded(): boolean {
    return this.#ffmpeg !== null;
  }

  /**
   * Bumped whenever the worker is torn down. Callers use it to notice that the
   * virtual filesystem was wiped and their inputs need writing again.
   */
  get generation(): number {
    return this.#generation;
  }

  async load(): Promise<FFmpeg> {
    if (this.#ffmpeg) return this.#ffmpeg;
    if (this.#loading) return this.#loading;

    this.#loading = (async () => {
      if (typeof WebAssembly === "undefined") {
        throw new RuntimeUnavailableError(
          "This browser has no WebAssembly support, so the video engine cannot start.",
        );
      }
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message }) => {
        this.#log.push(message);
        // The log is the only reliable progress signal for multi-input jobs.
        if (this.#log.length > 4000) this.#log.splice(0, 2000);
        this.#onLine?.(message);
      });
      // No `workerURL`: this is the single-threaded core, which has no pthread
      // pool to point at.
      await ffmpeg.load({
        coreURL: coreAsset("ffmpeg-core.js"),
        wasmURL: coreAsset("ffmpeg-core.wasm"),
      });
      this.#ffmpeg = ffmpeg;
      return ffmpeg;
    })();

    try {
      return await this.#loading;
    } catch (err) {
      this.#loading = null;
      throw err;
    }
  }

  /**
   * Reads stream details by opening the file with no output — ffmpeg prints the
   * stream table and then exits with an error, which is expected here.
   */
  async probe(path: string, data: Uint8Array, name: string): Promise<MediaInfo> {
    const ffmpeg = await this.load();
    await ffmpeg.writeFile(path, data);
    this.#log = [];
    await ffmpeg.exec(["-hide_banner", "-i", path]);
    return parseMediaInfo(this.#log.join("\n"), name, data.byteLength);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const ffmpeg = await this.load();
    await ffmpeg.writeFile(path, data);
  }

  /** Creating a directory that already exists is not worth failing over. */
  async ensureDir(path: string): Promise<void> {
    const ffmpeg = await this.load();
    await ffmpeg.createDir(path).catch(() => undefined);
  }

  async execPlan(plan: BuiltCommand, options: RunOptions): Promise<RunResult> {
    const ffmpeg = await this.load();
    this.#cancelled = false;

    for (const dir of new Set(plan.mkdirs)) {
      // Recreating an existing directory is not an error worth failing over.
      await ffmpeg.createDir(dir).catch(() => undefined);
    }
    for (const write of plan.writes) {
      await ffmpeg.writeFile(write.path, new TextEncoder().encode(write.content));
    }

    const totalWeight = plan.steps.reduce((sum, step) => sum + (step.weight ?? 1), 0);
    let completedWeight = 0;
    const collected: string[] = [];

    for (const step of plan.steps) {
      const weight = step.weight ?? 1;
      this.#log = [];
      options.onProgress?.(completedWeight / totalWeight, step.label);

      this.#onLine = (line) => {
        options.onLog?.(line);
        const time = parseProgressTime(line);
        if (time === null || options.expectedDuration <= 0) return;
        const stepFraction = Math.min(1, time / options.expectedDuration);
        options.onProgress?.((completedWeight + weight * stepFraction) / totalWeight, step.label);
      };

      let code: number;
      try {
        code = await ffmpeg.exec(["-nostdin", "-y", ...step.args]);
      } finally {
        this.#onLine = null;
      }

      collected.push(...this.#log);
      if (this.#cancelled) throw new JobCancelledError();
      if (code !== 0) {
        const detail = extractError(this.#log.join("\n"));
        throw new Error(detail ? `ffmpeg failed: ${detail}` : `ffmpeg exited with code ${code}.`);
      }

      completedWeight += weight;
      options.onProgress?.(completedWeight / totalWeight, step.label);
    }

    const artifacts: RunResult["artifacts"] = [];
    for (const output of plan.outputs) {
      if (output.kind === "file") {
        const data = (await ffmpeg.readFile(output.path)) as Uint8Array;
        if (!data.byteLength) throw new Error("ffmpeg produced an empty file.");
        artifacts.push({
          name: output.downloadName,
          mime: output.mime,
          blob: new Blob([data as BlobPart], { type: output.mime }),
        });
      } else {
        const entries = await ffmpeg.listDir(output.dir);
        const names = entries
          .filter((e) => !e.isDir && e.name.startsWith(output.prefix) && e.name.endsWith(`.${output.ext}`))
          .map((e) => e.name)
          .sort();
        if (!names.length) throw new Error("No frames were produced for that range.");
        for (const name of names) {
          const data = (await ffmpeg.readFile(`${output.dir}/${name}`)) as Uint8Array;
          artifacts.push({
            name,
            mime: output.mime,
            blob: new Blob([data as BlobPart], { type: output.mime }),
          });
        }
      }
    }

    return { artifacts, log: collected };
  }

  /** Best-effort cleanup so one job's files do not weigh on the next. */
  async cleanup(paths: string[], dirs: string[] = []): Promise<void> {
    const ffmpeg = this.#ffmpeg;
    if (!ffmpeg) return;
    for (const path of paths) {
      await ffmpeg.deleteFile(path).catch(() => undefined);
    }
    for (const dir of dirs) {
      const entries = await ffmpeg.listDir(dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDir) await ffmpeg.deleteFile(`${dir}/${entry.name}`).catch(() => undefined);
      }
    }
  }

  /**
   * ffmpeg.wasm has no way to interrupt a running command, so cancelling means
   * tearing the worker down. The next job pays for a fresh load.
   */
  cancel(): void {
    if (!this.#ffmpeg) return;
    this.#cancelled = true;
    this.#ffmpeg.terminate();
    this.#ffmpeg = null;
    this.#loading = null;
    this.#onLine = null;
    this.#generation += 1;
  }
}

export const videoRuntime = new VideoRuntime();
