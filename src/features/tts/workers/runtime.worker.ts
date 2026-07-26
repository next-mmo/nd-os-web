/// <reference lib="webworker" />
/**
 * Web Worker for CrispASR-based VoxCPM2 TTS.
 *
 * Runs the heavy 1.5 GB GGUF neural inference off the main thread so that
 * the browser UI never freezes during synthesis.
 *
 * Emscripten Threading rules (from CrispASR's `tts-worker.js`):
 *   1. Pthread-pool workers (self.name === 'em-pthread') do ONLY
 *      `importScripts` of the loader — nothing else.
 *   2. Instantiate the module at top level, never inside `onmessage`: the
 *      pthread bootstrap deadlocks when the factory is first called from
 *      an active message event.
 */

type RuntimeWorkerRequest =
  | {
      type: "init";
      jobId: string;
      baselmPath?: string;
      allowInterimEngine?: boolean;
      sampleRate?: number;
    }
  | {
      type: "generate";
      jobId: string;
      text: string;
      voiceDescription?: string;
      referenceTranscript?: string;
      styleInstruction?: string;
      seed?: number;
      guidance?: number;
      timesteps?: number;
      temperature?: number;
    }
  | { type: "cancel"; jobId: string }
  | { type: "unload" };

type RuntimeWorkerResponse =
  | { type: "status"; label: string; progress?: number; backend?: "webgpu" | "wasm" }
  | { type: "ready"; label: string; backend?: "webgpu" | "wasm" }
  | {
      type: "result";
      jobId: string;
      pcmBytes: ArrayBuffer;
      wavBytes: ArrayBuffer;
      sampleRate: number;
      durationSec: number;
    }
  | { type: "error"; jobId?: string; message: string };

function publicAssetUrl(path: string): string {
  if (import.meta.env.DEV) return new URL(`/${path}`, self.location.origin).href;
  // Production workers are emitted in `<base>/assets/`, while public assets
  // are copied to `<base>/`. Resolve from the worker URL so sub-path hosting
  // (including GitHub Pages) does not accidentally request the domain root.
  return new URL(`../${path}`, self.location.href).href;
}

// Public runtime assets are not fingerprinted by Vite. Bump this whenever the
// native build changes so browsers and deployment CDNs cannot reuse an older,
// numerically incompatible loader/WASM pair.
const CRISPASR_RUNTIME_VERSION = "2026-07-22-webgpu-native48-2";

/**
 * Asset URLs. The classic-blob bootstrap (runtime-factory) bakes absolute
 * URLs into `self.__CRISPASR_ASSETS` before importing this module — required
 * because a `blob:` worker cannot resolve public assets against its own
 * location. The fallback covers direct `?worker` construction (tests).
 */
const bakedAssets = (self as any).__CRISPASR_ASSETS as
  | { loader: string; wasm: string }
  | undefined;
const LOADER_PATH =
  bakedAssets?.loader ?? `${publicAssetUrl("crispasr/libwhisper.js")}?v=${CRISPASR_RUNTIME_VERSION}`;
const WASM_PATH =
  bakedAssets?.wasm ?? `${publicAssetUrl("crispasr/libwhisper.wasm")}?v=${CRISPASR_RUNTIME_VERSION}`;
const VOXCPM2_OUTPUT_SAMPLE_RATE = 48_000;

function crispModuleOptions() {
  return {
    locateFile: (path: string) => (path.endsWith(".wasm") ? WASM_PATH : path),
  };
}

/**
 * Load the Emscripten loader, which is a *classic* script that assigns
 * `whisper_factory` onto the global scope.
 *
 * `worker.format: "iife"` in vite.config.ts only applies to `vite build`; the
 * dev server always serves `?worker` imports as ES module workers, where
 * `importScripts` does not exist. Fetch-and-evaluate is the equivalent for
 * that context, so the same worker source runs in both dev and production.
 */
async function loadLoaderScript(url: string): Promise<void> {
  // Module workers still expose `importScripts`; it throws only when called,
  // so this has to be a try/catch rather than a capability check.
  if (typeof (self as any).importScripts === "function") {
    try {
      (self as any).importScripts(url);
      return;
    } catch {
      // Fall through to fetch-and-evaluate.
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch CrispASR loader (${response.status}) from ${url}`);
  }
  // Indirect eval evaluates in global scope, matching importScripts semantics
  // so the loader's `whisper_factory` lands on `self`.
  (0, eval)(await response.text());
}

// Messages can arrive before the async bootstrap installs the real handler.
// Buffer them so an `init` posted immediately after construction is not lost.
// The blob wrapper (runtime-factory) starts this buffer even earlier — while
// this module was still being fetched — so adopt its array if present.
const pendingMessages: MessageEvent<RuntimeWorkerRequest>[] =
  (self as any).__CRISPASR_PENDING ?? [];
self.onmessage = (event: MessageEvent<RuntimeWorkerRequest>) => {
  pendingMessages.push(event);
};

// Multi-threaded Emscripten launches helper threads from this worker's own
// URL with name 'em-pthread' (the loader spawns `new Worker(_scriptName,
// {name:"em-pthread"})`; `mainScriptUrlOrBlob` is compiled out of this
// build). They only need the loader script executed: its UMD tail ends with
// `isPthread && whisper_factory()`, so the factory self-boots — calling it
// again here would double-instantiate the module.
if (self.name === "em-pthread") {
  void loadLoaderScript(LOADER_PATH);
} else {
  void loadLoaderScript(LOADER_PATH).then(main, (err) => {
    self.postMessage({
      type: "error",
      message: `Failed to load CrispASR loader script from ${LOADER_PATH}: ${String(err)}`,
    } as RuntimeWorkerResponse);
  });
}

function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory = (self as any).whisper_factory;
  if (typeof factory !== "function") {
    sendError("Failed to load CrispASR loader script from " + LOADER_PATH);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any = null;
  let opened = false;
  let activeModelId: string | null = null;
  let webgpuBackendConfirmed = false;
  const recentRuntimeLogs: string[] = [];

  // Per-patch progress state, fed by parsing native stderr during synthesis.
  // The session opens at verbosity 2, where the AR loop prints
  // `voxcpm2: step N stop=…` for every generated patch — the only real
  // per-patch signal the binary exposes (asrGetProgress() is ASR-only and
  // stays at −1 for the whole TTS path).
  let synthesizing = false;
  let synthStartedAt = 0;
  let estMaxPatches = 0;

  const post = (msg: RuntimeWorkerResponse, transfer?: Transferable[]) => {
    self.postMessage(msg, transfer ?? []);
  };

  // Instantiate the WASM module at top level to prevent deadlocks on pthread boot.
  const reportRuntimeLog = (message: string) => {
    recentRuntimeLogs.push(message);
    if (recentRuntimeLogs.length > 24) recentRuntimeLogs.shift();
    console.info(`[CrispASR] ${message}`);
    if (/using preferred GPU backend:\s*WebGPU/i.test(message)) {
      webgpuBackendConfirmed = true;
    }

    if (synthesizing) {
      // The native AR ceiling is roughly 6 patches per prefill position + 10
      // (capped at 2000); the learned stop predictor usually fires far
      // earlier, so treat the ceiling as an upper bound, not a target.
      const tokenized = message.match(/tokenized .* -> (\d+) positions/);
      if (tokenized) estMaxPatches = Math.min(2000, Number(tokenized[1]) * 6 + 10);

      const step = message.match(/voxcpm2: step (\d+) /);
      if (step && estMaxPatches > 0) {
        const n = Number(step[1]);
        const elapsed = Math.round((Date.now() - synthStartedAt) / 1000);
        post({
          type: "status",
          label: `Synthesizing patch ${n + 1} (≤${estMaxPatches}) · ${elapsed}s`,
          progress: 0.1 + 0.85 * Math.min(1, (n + 1) / estMaxPatches),
          backend: webgpuBackendConfirmed ? "webgpu" : undefined,
        });
        return;
      }
    }

    // Carry other native stage logs through as labels only. (The previous
    // hardcoded `progress: 0.1` made every log line reset the bar to 10%.)
    post({
      type: "status",
      label: message,
      backend: webgpuBackendConfirmed ? "webgpu" : undefined,
    });
  };

  const moduleReady = factory({
    ...crispModuleOptions(),
    print: reportRuntimeLog,
    printErr: reportRuntimeLog,
  })
    .then((instance: unknown) => {
      M = instance;
      post({ type: "status", label: "CrispASR module initialized" });
    })
    .catch((err: unknown) => {
      sendError("Failed to instantiate CrispASR WASM module: " + String(err));
    });

  const handleMessage = async (event: MessageEvent<RuntimeWorkerRequest>) => {
    const msg = event.data;
    try {
      await moduleReady;

      switch (msg.type) {
        case "init": {
          if (opened && activeModelId === msg.baselmPath) {
            post({ type: "ready", label: "VoxCPM2 ready · model already loaded", backend: "webgpu" });
            return;
          }

          if (!msg.baselmPath) {
            // No model path provided — fall back to interim-DSP. But this is the
            // WASM worker, we don't run DSP here. The main thread handles
            // interim-DSP; if we reach here we expect GGUF.
            throw new Error("No model path provided for WASM init");
          }

          post({ type: "status", label: "Staging model in memory..." });
          // Read GGUF from OPFS and write into Emscripten MEMFS.
          const bytes = await readOpfsModel(msg.baselmPath);
          stageFile("/models/voxcpm2.gguf", bytes);

          if (!("gpu" in navigator)) {
            throw new Error("WebGPU is unavailable in this browser");
          }
          if (typeof M.setGpuBackend !== "function") {
            throw new Error("CrispASR runtime is missing WebGPU backend selection support");
          }

          webgpuBackendConfirmed = false;
          M.setGpuBackend("WebGPU");
          post({ type: "status", label: "Opening VoxCPM2-TTS on WebGPU..." });
          // Leave two cores for the browser/UI; ggml's CPU-side helpers are
          // the dominant cost when WebGPU offload is partial. (The previous
          // hardcoded 4 ignored the machine entirely.)
          const nThreads = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
          // Verbosity 2 is what makes the AR loop print the per-step lines
          // that reportRuntimeLog parses into real progress.
          const ok =
            typeof M.ttsOpenExplicitVerbose === "function"
              ? await M.ttsOpenExplicitVerbose("/models/voxcpm2.gguf", "voxcpm2-tts", nThreads, 2)
              : await M.ttsOpenExplicit("/models/voxcpm2.gguf", "voxcpm2-tts", nThreads);
          if (!ok) throw new Error("ttsOpenExplicit failed — model may be corrupt");
          if (!webgpuBackendConfirmed) {
            M.ttsClose?.();
            throw new Error("CrispASR did not confirm the WebGPU backend; CPU fallback is disabled");
          }

          // The GGUF loader has copied the weights into the wasm heap by now;
          // the MEMFS staging file is a dead second copy of the model (~1.5 GB
          // for Q4_K inside a 4 GiB wasm32 address space). Drop it before the
          // first synthesis allocates KV cache and graph buffers.
          try {
            M.FS_unlink("/models/voxcpm2.gguf");
          } catch {
            // Non-fatal: worst case we keep the old memory profile.
          }

          opened = true;
          activeModelId = msg.baselmPath;
          post({ type: "ready", label: "VoxCPM2 ready · GGUF WebGPU", backend: "webgpu" });
          break;
        }

        case "generate": {
          if (!opened) throw new Error("Session not opened — run init first");
          post({ type: "status", label: "Synthesizing speech on WebGPU...", progress: 0.1, backend: "webgpu" });

          // Configure per-request variables
          M.sessionSetTtsSteps?.(msg.timesteps ?? 10);
          M.sessionSetCfgWeight?.(msg.guidance ?? 2.0);
          if (typeof msg.seed === "number") M.sessionSetTtsSeed?.(msg.seed);

          // Do not override VoxCPM2's AR generation limit here. The native
          // runtime derives a safe ceiling from the actual BPE token count
          // (roughly 6 patches/token + 10, with a 2,000-patch hard limit) and
          // stops earlier through its learned stop predictor. A character-
          // based 12-96 patch cap truncates speech, particularly for Khmer.
          M.sessionSetMaxNewTokens?.(2000);

          // Infer language: default to Khmer if text contains Khmer chars, or
          // voice says so, else English.
          const isKhmer = /[\u1780-\u17ff]/.test(msg.text);
          M.sessionSetTargetLanguage?.(isKhmer ? "km" : "en");

          const t0 = Date.now();
          synthesizing = true;
          synthStartedAt = t0;
          estMaxPatches = 0;

          // Stall heartbeat. Real progress comes from the per-patch stderr
          // lines parsed in reportRuntimeLog; this timer only fires during
          // JSPI suspensions (GPU waits) and exists so long CPU-side stages
          // before the first patch still show measured elapsed time.
          const ticker = setInterval(() => {
            if (estMaxPatches > 0) return; // per-patch reporting has taken over
            const elapsed = Math.round((Date.now() - t0) / 1000);
            post({
              type: "status",
              label: `Synthesizing… ${elapsed}s elapsed`,
              progress: 0.1,
              backend: "webgpu",
            });
          }, 1000);

          // This script is already a dedicated Worker. The WebGPU build uses
          // JSPI, so the Embind call becomes awaitable while Dawn waits for
          // GPU work. Avoid the CPU-oriented ttsSynthesizeAsync pthread
          // trampoline, which cannot carry a JSPI suspension across its
          // detached C++ callback thread.
          let pcm: Float32Array;
          try {
            pcm = await Promise.resolve(M.ttsSynthesize(msg.text) as Float32Array);
          } finally {
            clearInterval(ticker);
            synthesizing = false;
          }

          if (!pcm || !pcm.length) throw new Error("Synthesis returned empty buffer");

          // AudioVAE v2 emits native 48 kHz mono. Preserve that rate through
          // the worker result and WAV header; the browser can resample at its
          // output boundary when the physical audio device uses another rate.
          const sampleRate = VOXCPM2_OUTPUT_SAMPLE_RATE;

          // Encode to WAV mono (WAV format expected by client).
          // Copy PCM out of the shared WASM heap before transferring it.
          const samples = new Float32Array(pcm);
          const signal = analyzePcmSignal(samples);
          if (signal.nonFiniteSamples > 0) {
            throw new Error(
              `Synthesis produced invalid PCM (${signal.nonFiniteSamples} non-finite samples)`,
            );
          }
          if (signal.peak < 1e-4 || signal.rms < 1e-5) {
            throw new Error(
              `Synthesis produced silent audio (peak=${signal.peak.toExponential(2)}, rms=${signal.rms.toExponential(2)})`,
            );
          }

          const durationSec = samples.length / sampleRate;
          const pcmBytes = samples.buffer;
          const wavBytes = encodeWavMono(samples, sampleRate);

          post(
            {
              type: "result",
              jobId: msg.jobId,
              pcmBytes,
              wavBytes,
              sampleRate,
              durationSec,
            },
            [pcmBytes, wavBytes],
          );
          break;
        }

        case "cancel":
          // Emscripten doesn't support active signal cancellation mid-run
          // from outside the loop, but we can set the cancels flag for future steps.
          post({ type: "status", label: "Cancelled" });
          break;

        case "unload":
          if (opened && M) {
            M.ttsClose?.();
          }
          opened = false;
          activeModelId = null;
          post({ type: "status", label: "Unloaded" });
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const diagnostic = recentRuntimeLogs.slice(-8).join(" | ");
      sendError(
        diagnostic ? `${message} · ${diagnostic}` : message,
        msg.type === "generate" ? msg.jobId : undefined,
      );
    }
  };

  // Take over from the bootstrap buffer, then replay anything that arrived
  // while the loader was still being fetched.
  self.onmessage = handleMessage;
  const buffered = pendingMessages.splice(0, pendingMessages.length);
  for (const event of buffered) void handleMessage(event);

  /** Stage bytes into the Emscripten MEMFS path. */
  function stageFile(path: string, bytes: Uint8Array): void {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    try {
      M.FS_createPath("/", dir.slice(1), true, true);
    } catch {
      // directory exists
    }
    try {
      M.FS_unlink(path);
    } catch {
      // file not there
    }
    M.FS_createDataFile(dir, name, bytes, true, true);
  }

  function sendError(message: string, jobId?: string) {
    post({
      type: "error",
      jobId,
      message,
    });
  }

  /** Read model file from OPFS storage. */
  async function readOpfsModel(modelId: string): Promise<Uint8Array> {
    const filename = `${modelId}.gguf`;
    const storageRoot = await navigator.storage.getDirectory();
    const appRoot = await storageRoot.getDirectoryHandle("tts-studio");
    const models = await appRoot.getDirectoryHandle("models");
    const handle = await models.getFileHandle(filename);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
}

/** Self-contained worker encoder keeps the classic worker free of ES imports. */
function encodeWavMono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
    offset += 2;
  }
  return buffer;
}

function analyzePcmSignal(samples: Float32Array): {
  peak: number;
  rms: number;
  nonFiniteSamples: number;
} {
  let peak = 0;
  let sumSquares = 0;
  let finiteSamples = 0;
  let nonFiniteSamples = 0;

  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      nonFiniteSamples++;
      continue;
    }
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    sumSquares += sample * sample;
    finiteSamples++;
  }

  return {
    peak,
    rms: finiteSamples > 0 ? Math.sqrt(sumSquares / finiteSamples) : 0,
    nonFiniteSamples,
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
