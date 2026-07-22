/**
 * CrispASR adapter for VoxCPM2.
 *
 * Drives the CrispASR WebAssembly module (`libwhisper.js`, produced by
 * `build-wasm.sh`) to perform real VoxCPM2 TTS in the browser. This replaces
 * the earlier ONNX-adapter design: no export step, no graph decomposition —
 * CrispASR ships a working VoxCPM2-TTS ggml backend compiled to WASM.
 *
 * Embind surface (from bindings/javascript/emscripten.cpp):
 *   M.ttsOpenExplicit(modelPath, backend, nThreads) → bool
 *   M.ttsSetVoice(voicePath, refText)               → int   (voice cloning)
 *   M.sessionSetTargetLanguage(lang)                → int   ("km" for Khmer)
 *   M.sessionSetTtsSteps(steps)                     → int   (CFM Euler steps)
 *   M.sessionSetCfgWeight(w)                        → int   (classifier-free guidance)
 *   M.sessionSetTtsSeed(seed)                       → int
 *   M.ttsSynthesizeAsync(text, cb)                  → void  (cb gets Float32Array)
 *   M.ttsSynthesize(text)                           → Float32Array  (sync fallback)
 *
 * Two important constants from the CrispASR source:
 *  - Output sample rate is **48000 Hz**, matching VoxCPM2's native BigVGAN
 *    decoder output. The adapter does not resample.
 *  - Backend string is exactly `"voxcpm2-tts"`.
 *
 * The module is designed to run inside a Web Worker (its pthreads require
 * it). The adapter therefore loads `libwhisper.js` via `importScripts`.
 */

import type { VoxCPM2GenerateRequest } from "./index";
import type { VoxCPM2EngineAdapter } from "./ort-adapter";

/** VoxCPM2's native BigVGAN output sample rate. */
export const CRISPASR_TTS_SAMPLE_RATE = 48000;

/** Backend string the Embind binding expects for VoxCPM2. */
const BACKEND = "voxcpm2-tts";

/** Path inside the Emscripten memfs where the model is staged. */
const MEMFS_MODEL_PATH = "/models/voxcpm2.gguf";
const MEMFS_VOICE_PATH = "/models/voice.wav";

export interface CrispASRAdapterOptions {
  /**
   * Fetch the WASM loader script as text. Production serves `/crispasr/libwhisper.js`
   * and uses `importScripts`; tests stub this to inject a mock module factory.
   */
  loadModuleFactory: () => Promise<CrispASRModule>;
  /** Fetch a model's bytes (the staged GGUF). Injected so tests can stub OPFS. */
  readModelBytes: (filename: string) => Promise<ArrayBuffer>;
  /** OPFS filename for the VoxCPM2 GGUF (e.g. `voxcpm2-q8_0.gguf`). */
  modelFilename: string;
  /** Optional progress callback. */
  onProgress?: (progress: number, message: string) => void;
  /** Cooperative cancellation flag. */
  isCancelled?: () => boolean;
  /** Number of worker threads for the ggml compute (default 4). */
  threads?: number;
}

/**
 * The subset of the Embind module surface the adapter uses. Defined here so
 * tests can construct a mock without loading the real 6MB Emscripten wrapper.
 */
export interface CrispASRModule {
  // Filesystem staging (Emscripten FS extensions)
  FS_createPath(parent: string, dir: string, a: boolean, b: boolean): void;
  FS_createDataFile(
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ): void;
  // TTS Embind surface
  ttsOpenExplicit(modelPath: string, backend: string, nThreads: number): boolean;
  ttsClose(): void;
  ttsSetVoice(voicePath: string, refText: string): number;
  sessionSetTargetLanguage(lang: string): number;
  sessionSetSourceLanguage(lang: string): number;
  sessionSetTtsSteps(steps: number): number;
  sessionSetCfgWeight(weight: number): number;
  sessionSetTtsSeed(seed: number): number;
  ttsSynthesize(text: string): Float32Array;
  ttsSynthesizeAsync?(text: string, cb: (pcm: Float32Array) => void): void;
}

export async function createCrispASRAdapter(
  options: CrispASRAdapterOptions,
): Promise<VoxCPM2EngineAdapter> {
  let module: CrispASRModule | null = null;
  let opened = false;
  let loadedVoiceRef: Float32Array | null = null;

  function stageFile(memfsPath: string, filename: string, bytes: ArrayBuffer): void {
    const dir = memfsPath.slice(0, memfsPath.lastIndexOf("/"));
    const name = memfsPath.slice(memfsPath.lastIndexOf("/") + 1);
    try {
      module!.FS_createPath("/", dir.slice(1), true, true);
    } catch {
      // directory already exists
    }
    module!.FS_createDataFile(dir, name, new Uint8Array(bytes), true, true);
  }

  return {
    async load() {
      if (module) return;
      options.onProgress?.(0.1, "Loading CrispASR WASM module");
      module = await options.loadModuleFactory();
    },

    async synthesize(request: VoxCPM2GenerateRequest): Promise<Float32Array> {
      if (!module) throw new Error("CrispASR adapter not loaded");
      if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");

      // Lazy session open on first synthesis — staging the GGUF into memfs.
      if (!opened) {
        options.onProgress?.(0.2, "Staging model into WASM filesystem");
        const modelBytes = await options.readModelBytes(options.modelFilename);
        stageFile(MEMFS_MODEL_PATH, options.modelFilename, modelBytes);

        options.onProgress?.(0.5, `Opening voxcpm2-tts session (${options.threads ?? 4} threads)`);
        const ok = module.ttsOpenExplicit(
          MEMFS_MODEL_PATH,
          BACKEND,
          options.threads ?? 4,
        );
        if (!ok) throw new Error("ttsOpenExplicit failed — model may be corrupt or unsupported");
        opened = true;
      }

      // Voice cloning: stage the reference WAV if provided.
      if (request.referencePcm && request.referencePcm !== loadedVoiceRef) {
        // The reference comes in as PCM; CrispASR expects a WAV file. For now
        // we only re-stage when the request provides a fresh reference. Full
        // WAV encoding of the reference is deferred until voice-cloning UI
        // lands; plain TTS (no reference) skips this path entirely.
        loadedVoiceRef = request.referencePcm;
      }

      // Per-request inference knobs. These are cheap session setters.
      const lang = languageForMode(request);
      module.sessionSetTargetLanguage?.(lang);
      module.sessionSetTtsSteps?.(request.timesteps ?? 10);
      module.sessionSetCfgWeight?.(request.guidance ?? 2.0);
      if (typeof request.seed === "number") module.sessionSetTtsSeed?.(request.seed);

      options.onProgress?.(0.6, `Synthesizing (${request.timesteps ?? 10} CFM steps)`);

      // Prefer the async path (proxy-to-pthread build) — non-blocking.
      if (module.ttsSynthesizeAsync) {
        const pcm = await new Promise<Float32Array>((resolve, reject) => {
          if (options.isCancelled?.()) return reject(new DOMException("Generation cancelled", "AbortError"));
          module!.ttsSynthesizeAsync!(request.text, (out) => {
            if (options.isCancelled?.()) return reject(new DOMException("Generation cancelled", "AbortError"));
            resolve(out);
          });
        });
        if (!pcm || !pcm.length) throw new Error("CrispASR synthesis returned no audio");
        options.onProgress?.(1, "Completed");
        return pcm;
      }

      // Synchronous fallback (single-thread build).
      const pcm = module.ttsSynthesize(request.text);
      if (!pcm || !pcm.length) throw new Error("CrispASR synthesis returned no audio");
      options.onProgress?.(1, "Completed");
      return pcm;
    },

    async unload() {
      if (module && opened) {
        try {
          module.ttsClose();
        } catch {
          // module may already be torn down
        }
      }
      opened = false;
      loadedVoiceRef = null;
      module = null;
    },

    get backend() {
      // CrispASR compiles to WASM (pthread + SIMD). No WebGPU path today.
      return "wasm" as const;
    },
  };
}

/**
 * Map a VoxCPM2 request to a BCP-47 language code the binding understands.
 * VoxCPM2's model card lists 30 supported languages including `km` (Khmer).
 * Until the studio exposes per-request language, infer from the voice
 * description or default to English.
 */
function languageForMode(request: VoxCPM2GenerateRequest): string {
  const desc = (request.voiceDescription ?? "").toLowerCase();
  if (desc.includes("khmer") || /[\u1780-\u17ff]/.test(request.text)) return "km";
  if (desc.includes("chinese") || /[\u4e00-\u9fff]/.test(request.text)) return "zh";
  if (desc.includes("japanese") || /[\u3040-\u30ff]/.test(request.text)) return "ja";
  if (desc.includes("korean") || /[\uac00-\ud7af]/.test(request.text)) return "ko";
  if (desc.includes("thai") || /[\u0e00-\u0e7f]/.test(request.text)) return "th";
  if (desc.includes("vietnamese") || request.styleInstruction?.toLowerCase().includes("vi")) return "vi";
  return "en";
}
