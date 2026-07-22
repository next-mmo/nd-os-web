/**
 * Production wiring between the VoxCPM2 manifest/OPFS storage and the
 * runtime.
 *
 * `createStudioRuntime()` decides at boot whether to build a worker-backed
 * CrispASR runtime (when a VoxCPM2 GGUF is installed in OPFS) or to run an
 * in-thread interim-DSP runtime.
 *
 * Running CrispASR's 1.5 GB GGUF neural inference MUST happen inside a Web
 * Worker because Emscripten's pthreads require a Worker context to prevent
 * browser main-thread deadlocks.
 */

import {
  resolveModelFile,
  VOXCPM2_MANIFEST,
} from "@nd-os/model-storage";
import {
  createVoxCPM2Runtime,
  type VoxCPM2Runtime,
  type RuntimeStatus,
  type RuntimeMemoryUsage,
} from "@nd-os/voxcpm2-web-runtime";
import type { RuntimeWorkerRequest, RuntimeWorkerResponse } from "../../../src/features/tts/workers/messages";
import VoxCPM2Worker from "../../../src/features/tts/workers/runtime.worker?worker";

export interface StudioRuntimeOptions {
  /** Override the list of installed model ids (mostly for tests). */
  installedModelIds?: string[];
  /** Injected worker constructor (Vite worker import). */
  WorkerClass?: new () => Worker;
}

/**
 * Build a runtime bound to OPFS-stored VoxCPM2 GGUF models.
 * Spawns `runtime.worker.ts` to offload inference if GGUF is installed.
 */
export async function createStudioRuntime(
  options: StudioRuntimeOptions = {},
): Promise<VoxCPM2Runtime> {
  const installed = new Set(options.installedModelIds ?? (await listInstalledModelIds()));
  // Any published VoxCPM2 GGUF variant is a complete model. Manifest order
  // provides the preference when more than one quantization is installed.
  const installedGGUF = VOXCPM2_MANIFEST.models.find(
    (m) => (m.format ?? "gguf") === "gguf" && installed.has(m.id),
  );

  if (!installedGGUF) {
    // No model installed yet — return interim-DSP runtime (in-thread).
    return createVoxCPM2Runtime();
  }

  const resolved = resolveModelFile(VOXCPM2_MANIFEST, installedGGUF.id);
  if (!resolved) {
    return createVoxCPM2Runtime();
  }

  // `?worker` makes Vite transpile TypeScript and emit a classic IIFE worker;
  // the previous new-URL form was copied verbatim as an unusable `.ts` file.
  const WorkerConstructor = options.WorkerClass ?? VoxCPM2Worker;

  return createWorkerProxyRuntime(resolved.filename, installedGGUF.bytes, WorkerConstructor);
}

/** Proxy implementing VoxCPM2Runtime that communicates with runtime.worker.ts */
function createWorkerProxyRuntime(
  modelFilename: string,
  estimatedModelBytes: number,
  WorkerClass: new () => Worker,
): VoxCPM2Runtime {
  let worker: Worker | null = null;
  let status: RuntimeStatus = {
    code: "idle",
    backend: "unavailable",
    label: "VoxCPM2 idle",
  };
  let activeBackend: RuntimeStatus["backend"] = "unavailable";
  let activeInitPromise: {
    resolve: () => void;
    reject: (err: any) => void;
  } | null = null;
  let activeGeneratePromise: {
    resolve: (val: any) => void;
    reject: (err: any) => void;
    callbacks: any;
  } | null = null;

  function initWorker() {
    if (worker) return;
    worker = new WorkerClass();
    const fail = (message: string) => {
      status = {
        code: "error",
        backend: activeBackend,
        label: "Runtime error",
        detail: message,
      };
      if (activeInitPromise) {
        const { reject } = activeInitPromise;
        activeInitPromise = null;
        reject(new Error(message));
      }
      if (activeGeneratePromise) {
        const { reject } = activeGeneratePromise;
        activeGeneratePromise = null;
        reject(new Error(message));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(event.message || "VoxCPM2 worker failed to start");
    };
    worker.onmessageerror = () => fail("VoxCPM2 worker returned an unreadable message");
    worker.onmessage = (event: MessageEvent<RuntimeWorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "status":
          const isReady = msg.label.toLowerCase().includes("ready");
          activeBackend = msg.backend ?? activeBackend;
          status = {
            code: isReady ? "ready" : msg.progress !== undefined ? "generating" : "loading",
            backend: activeBackend,
            label: msg.label,
            progress: msg.progress,
          };
          if (activeGeneratePromise?.callbacks?.onProgress && msg.progress !== undefined) {
            activeGeneratePromise.callbacks.onProgress(msg.progress, msg.label);
          }
          if (activeInitPromise && isReady) {
            const { resolve } = activeInitPromise;
            activeInitPromise = null;
            resolve();
          }
          break;

        case "result":
          if (activeGeneratePromise) {
            const { resolve } = activeGeneratePromise;
            activeGeneratePromise = null;
            const sampleRate = msg.sampleRate;
            const samples = new Float32Array(msg.pcmBytes);
            resolve({
              jobId: msg.jobId,
              audio: {
                samples,
                sampleRate,
                channels: 1,
                durationSec: msg.durationSec,
              },
              wavBytes: msg.wavBytes,
              providerId: "voxcpm2",
              backend: activeBackend,
              createdAt: Date.now(),
              metadata: {
                engine: `voxcpm2-ggml-${activeBackend}`,
                aiGenerated: true,
              },
            });
          }
          break;

        case "error":
          fail(msg.message);
          break;
      }
    };
  }

  return {
    async initialize(options) {
      initWorker();
      status = {
        code: "loading",
        backend: "unavailable",
        label: "Loading model",
      };
      activeBackend = "unavailable";
      return new Promise<void>((resolve, reject) => {
        const timeout = globalThis.setTimeout(() => {
          if (!activeInitPromise) return;
          activeInitPromise = null;
          reject(new Error("VoxCPM2 model loading timed out after 120 seconds"));
        }, 120_000);
        activeInitPromise = {
          resolve: () => {
            globalThis.clearTimeout(timeout);
            resolve();
          },
          reject: (error) => {
            globalThis.clearTimeout(timeout);
            reject(error);
          },
        };
        worker!.postMessage({
          type: "init",
          jobId: "init-task",
          baselmPath: modelFilename.replace(/\.gguf$/, ""),
          allowInterimEngine: options.allowInterimEngine,
          sampleRate: options.sampleRate,
        } as RuntimeWorkerRequest);
      });
    },

    async generate(request) {
      return this.generateStream(request, {});
    },

    async generateStream(request, callbacks) {
      if (!worker) throw new Error("Worker not initialized");
      if (activeGeneratePromise) throw new Error("Another generation is active");

      return new Promise<any>((resolve, reject) => {
        activeGeneratePromise = { resolve, reject, callbacks };
        worker!.postMessage({
          type: "generate",
          jobId: request.jobId,
          text: request.text,
          seed: request.seed,
          guidance: request.guidance,
          timesteps: request.timesteps,
          temperature: request.temperature,
          voiceDescription: request.voiceDescription,
          referenceTranscript: request.referenceTranscript,
          styleInstruction: request.styleInstruction,
        } as RuntimeWorkerRequest);
      });
    },

    async cancel() {
      if (worker) {
        worker.postMessage({ type: "cancel", jobId: "active" } as RuntimeWorkerRequest);
      }
    },

    async unload() {
      if (worker) {
        worker.postMessage({ type: "unload" } as RuntimeWorkerRequest);
        worker.terminate();
        worker = null;
      }
      status = {
        code: "idle",
        backend: "unavailable",
        label: "VoxCPM2 idle",
      };
    },

    getStatus() {
      return status;
    },

    getMemoryUsage(): RuntimeMemoryUsage {
      return {
        estimatedModelBytes,
      };
    },
  };
}

/**
 * List the model-file ids present in OPFS, derived from filenames.
 * Mirrors `providerModelManager.refreshInstalled` logic but without its
 * in-memory cache so we always reflect disk at boot.
 */
async function listInstalledModelIds(): Promise<string[]> {
  try {
    const { listOpfsFiles } = await import("@nd-os/model-storage");
    const files = await listOpfsFiles("models");
    return files
      .filter((f) => f.endsWith(".onnx") || f.endsWith(".gguf"))
      .map((f) => f.replace(/\.(onnx|gguf)$/, ""));
  } catch {
    return [];
  }
}
