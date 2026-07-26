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
import { crispasrAssetUrls } from "../../../src/features/tts/workers/crispasr-paths";
import workerModuleUrl from "../../../src/features/tts/workers/runtime.worker?worker&url";

/**
 * Construct the runtime worker from a classic `blob:` bootstrap.
 *
 * Why not `?worker` directly: Emscripten's pthread pool spawns helper workers
 * from the parent worker's own URL (`new Worker(_scriptName, {name:
 * "em-pthread"})` — `mainScriptUrlOrBlob` is compiled out of the shipped
 * loader). In dev, Vite serves `?worker` as an ES module, which a classic
 * pthread helper cannot execute — the pool silently fails and ggml computes
 * single-threaded (measured: one core pegged, GPU idle). With this bootstrap
 * the worker's URL *is* a classic script: helper threads re-execute it under
 * `name === "em-pthread"`, importScripts the loader, and its UMD tail
 * self-boots the pthread. The primary path dynamic-imports the real worker
 * module (legal in classic workers), with the CrispASR asset URLs baked in
 * because a `blob:` context cannot resolve public assets relative to itself.
 */
function createRuntimeWorkerViaBlob(): Worker {
  const assets = crispasrAssetUrls(globalThis.location.href);
  const moduleUrl = new URL(workerModuleUrl, globalThis.location.href).href;
  const src = [
    `if (self.name === "em-pthread") {`,
    `  importScripts(${JSON.stringify(assets.loader)});`,
    `} else {`,
    `  self.__CRISPASR_ASSETS = ${JSON.stringify(assets)};`,
    // The browser only auto-queues messages until the INITIAL script finishes,
    // and this wrapper finishes immediately — while the dynamic import is
    // still in flight. Without a buffering handler here, the proxy's "init"
    // (posted right after construction) is dispatched with no listener and
    // silently lost; the module takes over this same array when it loads.
    `  self.__CRISPASR_PENDING = [];`,
    `  self.onmessage = function (e) { self.__CRISPASR_PENDING.push(e); };`,
    `  import(${JSON.stringify(moduleUrl)}).catch(function (e) {`,
    `    self.postMessage({ type: "error", message: "Worker bootstrap failed: " + (e && e.message ? e.message : e) });`,
    `  });`,
    `}`,
  ].join("\n");
  return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
}

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
  // An empty `installedModelIds` means "caller didn't know", not "nothing is
  // installed" — `generate()` auto-initializes with `[]`. Using `??` here made
  // that empty array win over OPFS discovery, so an installed GGUF was never
  // found and every generation silently fell through to the interim DSP.
  const explicitIds = options.installedModelIds;
  const installed = new Set(
    explicitIds && explicitIds.length > 0 ? explicitIds : await listInstalledModelIds(),
  );
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

  const createWorker = options.WorkerClass
    ? () => new options.WorkerClass!()
    : createRuntimeWorkerViaBlob;

  return createWorkerProxyRuntime(resolved.filename, installedGGUF.bytes, createWorker);
}

/** Proxy implementing VoxCPM2Runtime that communicates with runtime.worker.ts */
function createWorkerProxyRuntime(
  modelFilename: string,
  estimatedModelBytes: number,
  createWorker: () => Worker,
): VoxCPM2Runtime {
  let worker: Worker | null = null;
  let status: RuntimeStatus = {
    code: "idle",
    backend: "unavailable",
    label: "VoxCPM2 idle",
  };
  let activeBackend: RuntimeStatus["backend"] = "unavailable";
  // Remembered so a post-cancel generate can transparently reload the model.
  let lastInitOptions: Parameters<VoxCPM2Runtime["initialize"]>[0] | null = null;
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
    worker = createWorker();
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
          // Status messages are informational only (the worker forwards every
          // native stdout/stderr line as one). Readiness arrives as an
          // explicit "ready" message — inferring it from a "ready" substring
          // here used to trip on ggml's own "ggml buffer ready" load logs,
          // resolving init early and swallowing the real error.
          activeBackend = msg.backend ?? activeBackend;
          status = {
            code: msg.progress !== undefined ? "generating" : "loading",
            backend: activeBackend,
            label: msg.label,
            progress: msg.progress,
          };
          if (activeGeneratePromise?.callbacks?.onProgress && msg.progress !== undefined) {
            activeGeneratePromise.callbacks.onProgress(msg.progress, msg.label);
          }
          break;

        case "ready":
          activeBackend = msg.backend ?? activeBackend;
          status = {
            code: "ready",
            backend: activeBackend,
            label: msg.label,
          };
          if (activeInitPromise) {
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

  const proxy: VoxCPM2Runtime = {
    async initialize(options) {
      lastInitOptions = options;
      initWorker();
      status = {
        code: "loading",
        backend: "unavailable",
        label: "Loading model",
      };
      activeBackend = "unavailable";
      return new Promise<void>((resolve, reject) => {
        // Cold load is dominated by staging 1.6 GB from OPFS and uploading
        // dequantized weights to the GPU — measured ~2.5 minutes on an
        // RTX 4070 desktop, so the previous 120 s ceiling could never pass.
        // The worker's explicit "ready" message resolves well before this on
        // warm loads; the timeout is only a last-resort hang guard.
        const timeout = globalThis.setTimeout(() => {
          if (!activeInitPromise) return;
          activeInitPromise = null;
          reject(new Error("VoxCPM2 model loading timed out after 10 minutes"));
        }, 600_000);
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
      return proxy.generateStream(request, {});
    },

    async generateStream(request, callbacks) {
      // A prior cancel() tore the worker down. Transparently reload the
      // model (the caller's provider believes it is still initialized).
      if (!worker && lastInitOptions) await proxy.initialize(lastInitOptions);
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
      // The shipped binary has no native abort: the VoxCPM2 AR loop checks no
      // cancellation flag of any kind, so a cooperative "cancel" message
      // could only be observed after synthesis already finished. Terminating
      // the worker is the ONLY way to stop the computation and free the
      // CPU/GPU. The model is gone with the worker; the next generateStream
      // reloads it via lastInitOptions.
      if (!worker) return;
      const w = worker;
      worker = null;
      w.terminate();
      status = {
        code: "idle",
        backend: "unavailable",
        label: "Cancelled — model reloads on next generate",
      };
      const abort = () => new DOMException("Generation cancelled", "AbortError");
      if (activeGeneratePromise) {
        const { reject } = activeGeneratePromise;
        activeGeneratePromise = null;
        reject(abort());
      }
      if (activeInitPromise) {
        const { reject } = activeInitPromise;
        activeInitPromise = null;
        reject(abort());
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
  return proxy;
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
