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
  | {
      type: "result";
      jobId: string;
      pcmBytes: ArrayBuffer;
      wavBytes: ArrayBuffer;
      sampleRate: number;
      durationSec: number;
    }
  | { type: "error"; jobId?: string; message: string };

const LOADER_PATH = "/crispasr/libwhisper.js";
const WASM_PATH = "/crispasr/libwhisper.wasm";

function crispModuleOptions() {
  return {
    locateFile: (path: string) => (path.endsWith(".wasm") ? WASM_PATH : path),
  };
}

// Multi-threaded Emscripten launches helper threads that run this script
// with name 'em-pthread'. They must bootstrap the loader and exit early.
if (self.name === "em-pthread") {
  // @ts-ignore
  importScripts(LOADER_PATH);
  // The modularized Emscripten loader must be invoked so it installs its
  // pthread message handler in this helper worker.
  // @ts-ignore
  void (self as any).whisper_factory(crispModuleOptions());
} else {
  main();
}

function main() {
  // @ts-ignore
  importScripts(LOADER_PATH);

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
    // During synthesis, carry native stage logs through the existing progress
    // callback so the UI exposes the real WebGPU stage instead of appearing
    // frozen at a generic 10% label.
    post({
      type: "status",
      label: message,
      progress: opened ? 0.1 : undefined,
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

  self.onmessage = async (event: MessageEvent<RuntimeWorkerRequest>) => {
    const msg = event.data;
    try {
      await moduleReady;

      switch (msg.type) {
        case "init": {
          if (opened && activeModelId === msg.baselmPath) {
            post({ type: "status", label: "Model already loaded" });
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
          const ok =
            typeof M.ttsOpenExplicitVerbose === "function"
              ? await M.ttsOpenExplicitVerbose("/models/voxcpm2.gguf", "voxcpm2-tts", 4, 1)
              : await M.ttsOpenExplicit("/models/voxcpm2.gguf", "voxcpm2-tts", 4);
          if (!ok) throw new Error("ttsOpenExplicit failed — model may be corrupt");
          if (!webgpuBackendConfirmed) {
            M.ttsClose?.();
            throw new Error("CrispASR did not confirm the WebGPU backend; CPU fallback is disabled");
          }

          opened = true;
          activeModelId = msg.baselmPath;
          post({ type: "status", label: "VoxCPM2 ready · GGUF WebGPU", backend: "webgpu" });
          break;
        }

        case "generate": {
          if (!opened) throw new Error("Session not opened — run init first");
          post({ type: "status", label: "Synthesizing speech on WebGPU...", progress: 0.1, backend: "webgpu" });

          // Configure per-request variables
          M.sessionSetTtsSteps?.(msg.timesteps ?? 10);
          M.sessionSetCfgWeight?.(msg.guidance ?? 2.0);
          if (typeof msg.seed === "number") M.sessionSetTtsSeed?.(msg.seed);
          // Bound the autoregressive loop to the requested text instead of
          // letting tokenizer byte-counts make short Khmer text run hundreds
          // of patches. VoxCPM2 may still stop earlier via its stop predictor.
          const textLength = Array.from(msg.text.trim()).length;
          const maxArSteps = Math.min(96, Math.max(12, Math.ceil(textLength * 2.5)));
          M.sessionSetMaxNewTokens?.(maxArSteps);

          // Infer language: default to Khmer if text contains Khmer chars, or
          // voice says so, else English.
          const isKhmer = /[\u1780-\u17ff]/.test(msg.text);
          M.sessionSetTargetLanguage?.(isKhmer ? "km" : "en");

          const t0 = Date.now();

          // This script is already a dedicated Worker. The WebGPU build uses
          // Asyncify, so the Embind call becomes awaitable while Dawn waits for
          // GPU work. Avoid the CPU-oriented ttsSynthesizeAsync pthread
          // trampoline, which cannot carry an Asyncify suspension across its
          // detached C++ callback thread.
          const pcm = await Promise.resolve(M.ttsSynthesize(msg.text) as Float32Array);

          if (!pcm || !pcm.length) throw new Error("Synthesis returned empty buffer");

          // The CrispASR session ABI normalizes VoxCPM2's native 48 kHz
          // decoder output to 24 kHz mono before returning it. Keep the WAV
          // header and duration aligned with the actual samples.
          const sampleRate = 24000;
          const durationSec = pcm.length / sampleRate;

          // Encode to WAV mono (WAV format expected by client).
          // Copy PCM out of the shared WASM heap before transferring it.
          const samples = new Float32Array(pcm);
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

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
