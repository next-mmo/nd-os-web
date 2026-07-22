import { audioBufferHasSignal, encodeWavMono } from "@nd-os/audio-engine";
import type {
  RuntimeBackend,
  RuntimeMemoryUsage,
  RuntimeStatus,
  TTSResult,
} from "@nd-os/shared-types";
import type { VoxCPM2EngineAdapter } from "./ort-adapter";

export { createOrtAdapter } from "./ort-adapter";
export type { VoxCPM2EngineAdapter, OrtAdapterOptions } from "./ort-adapter";
export { createMockAdapter } from "./mock-adapter";
export {
  createCrispASRAdapter,
  CRISPASR_TTS_SAMPLE_RATE,
  type CrispASRAdapterOptions,
  type CrispASRModule,
} from "./crispasr-adapter";

export interface VoxCPM2InitializeOptions {
  baselmPath?: string;
  acousticPath?: string;
  preferWebGpu?: boolean;
  /** When true, allow interim local DSP engine if WASM is unavailable. */
  allowInterimEngine?: boolean;
  sampleRate?: number;
}

export interface VoxCPM2GenerateRequest {
  jobId: string;
  text: string;
  mode?: "tts" | "voice-design" | "voice-clone" | "hf-clone";
  voiceDescription?: string;
  referencePcm?: Float32Array;
  referenceSampleRate?: number;
  referenceTranscript?: string;
  styleInstruction?: string;
  seed?: number;
  guidance?: number;
  timesteps?: number;
  temperature?: number;
}

export interface VoxCPM2StreamCallbacks {
  onProgress?: (progress: number, message: string) => void;
  onAudioChunk?: (samples: Float32Array, sampleRate: number) => void;
}

export interface VoxCPM2Runtime {
  initialize(options: VoxCPM2InitializeOptions): Promise<void>;
  generate(request: VoxCPM2GenerateRequest): Promise<TTSResult>;
  generateStream(
    request: VoxCPM2GenerateRequest,
    callbacks: VoxCPM2StreamCallbacks,
  ): Promise<TTSResult>;
  cancel(): Promise<void>;
  unload(): Promise<void>;
  getStatus(): RuntimeStatus;
  getMemoryUsage(): RuntimeMemoryUsage;
}

type EngineKind = "onnx" | "interim-dsp";

/**
 * Browser runtime for VoxCPM2.
 *
 * Engine tiers, in priority order:
 *  1. **ONNX Runtime Web** (primary) — loads the BaseLM + Acoustic ONNX models
 *     from OPFS, runs via WebGPU executor when available, falling back to WASM.
 *     Selected when an adapter is wired (production binds one to OPFS; tests
 *     inject a mock).
 *  2. **Interim DSP** (fallback) — local formant/phoneme synthesizer. Produces
 *     real non-silent PCM so the studio vertical slice works offline, but is
 *     clearly labelled as non-neural (`backend: "browser-speech"`).
 *
 * Status never claims `webgpu` or `wasm` unless a real ONNX session is driving
 * inference. The interim path reports `browser-speech` honestly.
 */
export interface CreateRuntimeOptions {
  /**
   * Engine adapter to use. Production passes `createOrtAdapter({...})`; tests
   * pass `createMockAdapter({...})`. When omitted, the runtime runs interim-DSP
   * only (no OPFS binding is possible without the model filenames).
   */
  adapter?: VoxCPM2EngineAdapter;
}

export function createVoxCPM2Runtime(
  createOptions: CreateRuntimeOptions = {},
): VoxCPM2Runtime {
  let status: RuntimeStatus = {
    code: "idle",
    backend: "unavailable",
    label: "VoxCPM2 idle",
  };
  let engine: EngineKind | null = null;
  let cancelled = false;
  let sampleRate = 48000;
  const adapter = createOptions.adapter ?? null;

  return {
    async initialize(options) {
      cancelled = false;
      sampleRate = options.sampleRate ?? 48000;
      status = {
        code: "loading",
        backend: "unavailable",
        label: "Loading model",
        progress: 0.1,
      };

      if (adapter) {
        try {
          await adapter.load();
          engine = "onnx";
          const backend: RuntimeBackend =
            adapter.backend === "webgpu" ? "webgpu" : "wasm";
          status = {
            code: "ready",
            backend,
            label:
              backend === "webgpu"
                ? "VoxCPM2 ready · ONNX WebGPU"
                : "VoxCPM2 ready · ONNX WASM",
            detail: options.baselmPath
              ? `Models: ${options.baselmPath}${options.acousticPath ? `, ${options.acousticPath}` : ""}`
              : "ONNX runtime loaded",
          };
          return;
        } catch (err) {
          // Adapter failed to load (missing models, unsupported graph, OOM).
          // Fall through to interim-DSP if allowed, else surface the error.
          if (options.allowInterimEngine === false) {
            engine = null;
            status = {
              code: "error",
              backend: "unavailable",
              label: "ONNX load failed",
              detail: err instanceof Error ? err.message : String(err),
            };
            throw err;
          }
        }
      }

      if (options.allowInterimEngine !== false) {
        engine = "interim-dsp";
        status = {
          code: "ready",
          backend: "browser-speech",
          label: "Interim DSP (not neural)",
          detail:
            "VoxCPM2 ONNX models not installed. Using local DSP placeholder so the studio flow works. Install the BaseLM + Acoustic ONNX models to enable neural synthesis.",
        };
        return;
      }

      engine = null;
      status = {
        code: "unsupported",
        backend: "unavailable",
        label: "No engine available",
        detail: "No VoxCPM2 engine is available on this device.",
      };
      throw new Error(status.detail);
    },

    async generate(request) {
      return this.generateStream(request, {});
    },

    async generateStream(request, callbacks) {
      if (!engine) {
        throw new Error("Runtime not initialized");
      }
      cancelled = false;
      status = {
        code: "generating",
        backend: status.backend,
        label: "Generating",
        progress: 0,
      };

      const text = request.text.trim();
      if (!text) throw new Error("Text is empty");

      callbacks.onProgress?.(0.05, "Preparing text");

      let samples: Float32Array;
      if (engine === "onnx" && adapter) {
        // Neural path: the FULL request reaches the adapter (seed, mode,
        // guidance, timesteps, temperature, reference PCM, transcripts). The
        // adapter marshals these into the ONNX graph inputs.
        callbacks.onProgress?.(0.2, "Running VoxCPM2 ONNX");
        samples = await adapter.synthesize({ ...request, text });
      } else {
        callbacks.onProgress?.(0.2, "Running interim DSP engine");
        samples = await synthesizeInterimSpeech(text, sampleRate, {
          seed: request.seed ?? 42,
          voiceDescription: request.voiceDescription,
          onProgress: (p, msg) => {
            if (cancelled) throw new DOMException("Generation cancelled", "AbortError");
            callbacks.onProgress?.(0.2 + p * 0.7, msg);
          },
          isCancelled: () => cancelled,
        });
      }

      if (cancelled) throw new DOMException("Generation cancelled", "AbortError");

      callbacks.onProgress?.(0.92, "Encoding audio");
      status = {
        code: "generating",
        backend: status.backend,
        label: "Encoding audio",
        progress: 0.92,
      };

      if (!audioBufferHasSignal(samples)) {
        throw new Error("Audio encoding failed: generated buffer is silent");
      }

      const wavBytes = encodeWavMono(samples, sampleRate);

      // Backend is reported honestly: ONNX-on-WebGPU → "webgpu",
      // ONNX-on-WASM → "wasm", interim DSP → "browser-speech".
      const backend: RuntimeBackend = status.backend;

      status = {
        code: "ready",
        backend,
        label:
          engine === "onnx"
            ? backend === "webgpu"
              ? "VoxCPM2 ready · ONNX WebGPU"
              : "VoxCPM2 ready · ONNX WASM"
            : "Interim DSP (not neural)",
      };

      return {
        jobId: request.jobId,
        audio: {
          samples,
          sampleRate,
          channels: 1,
          durationSec: samples.length / sampleRate,
        },
        wavBytes,
        providerId: "voxcpm2",
        backend,
        seed: request.seed,
        createdAt: Date.now(),
        metadata: {
          engine: engine === "onnx" ? `voxcpm2-onnx-${backend}` : "interim-dsp",
          aiGenerated: true,
        },
      };
    },

    async cancel() {
      cancelled = true;
      status = {
        code: "cancelling",
        backend: status.backend,
        label: "Cancelling",
      };
    },

    async unload() {
      await adapter?.unload();
      engine = null;
      status = {
        code: "idle",
        backend: "unavailable",
        label: "VoxCPM2 idle",
      };
    },

    getStatus() {
      return { ...status };
    },

    getMemoryUsage(): RuntimeMemoryUsage {
      const mem = (performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      }).memory;
      return {
        jsHeapUsedBytes: mem?.usedJSHeapSize,
        jsHeapTotalBytes: mem?.totalJSHeapSize,
        deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      };
    },
  };
}

/**
 * Interim offline speech engine: formant / phoneme DSP.
 * Produces real, non-silent, text-dependent PCM at the requested sample rate.
 * Not VoxCPM2 quality — used only when the ONNX runtime is absent.
 */
async function synthesizeInterimSpeech(
  text: string,
  sampleRate: number,
  opts: {
    seed: number;
    voiceDescription?: string;
    onProgress?: (p: number, msg: string) => void;
    isCancelled?: () => boolean;
  },
): Promise<Float32Array> {
  const units = tokenizeSpeechUnits(text);
  const pitchBase = pitchFromDescription(opts.voiceDescription, opts.seed);
  const secondsPerUnit = 0.085 + (opts.seed % 7) * 0.002;
  const totalSamples = Math.max(
    Math.floor(sampleRate * 0.35),
    Math.floor(units.length * secondsPerUnit * sampleRate),
  );
  const out = new Float32Array(totalSamples);
  let cursor = 0;
  let phase = 0;

  for (let i = 0; i < units.length; i++) {
    if (opts.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");
    opts.onProgress?.(i / units.length, `Synthesizing unit ${i + 1}/${units.length}`);

    const unit = units[i]!;
    const dur = Math.floor(secondsPerUnit * sampleRate * unit.durationScale);
    const f0 = pitchBase * unit.pitchScale;
    const [f1, f2, f3] = unit.formants;

    for (let n = 0; n < dur && cursor < totalSamples; n++, cursor++) {
      const t = n / sampleRate;
      const env = envelope(n, dur);
      // Voiced source
      phase += (2 * Math.PI * f0) / sampleRate;
      const glottal = Math.sin(phase) * 0.55 + Math.sin(phase * 2) * 0.2;
      const noise = (Math.random() * 2 - 1) * (unit.voiced ? 0.03 : 0.25);
      const source = unit.voiced ? glottal + noise : noise;
      const res =
        formant(source, t, f1, 60) * 0.55 +
        formant(source, t, f2, 90) * 0.35 +
        formant(source, t, f3, 120) * 0.2;
      out[cursor] = Math.max(-1, Math.min(1, res * env * 0.45));
    }

    // Short pause between words
    if (unit.pauseAfter) {
      cursor = Math.min(totalSamples, cursor + Math.floor(sampleRate * 0.06));
    }

    // Yield to keep UI responsive when called on main/worker
    if (i % 8 === 0) await Promise.resolve();
  }

  // Soft fade out
  const fade = Math.min(sampleRate * 0.04, out.length);
  for (let i = 0; i < fade; i++) {
    const idx = out.length - 1 - i;
    out[idx]! *= i / fade;
  }

  return out;
}

type SpeechUnit = {
  formants: [number, number, number];
  pitchScale: number;
  durationScale: number;
  voiced: boolean;
  pauseAfter: boolean;
};

function tokenizeSpeechUnits(text: string): SpeechUnit[] {
  const units: SpeechUnit[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (/\s/.test(ch)) {
      if (units.length) units[units.length - 1]!.pauseAfter = true;
      continue;
    }
    const code = ch.codePointAt(0) ?? 65;
    const isKhmer = code >= 0x1780 && code <= 0x17ff;
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
    const vowel = /[aeiouAEIOUអឥឦឧឨឩឪឫឬឭឮឯឰឱឲឳ]/.test(ch);
    const base = 250 + (code % 500);
    units.push({
      formants: [
        base,
        800 + (code % 900),
        1800 + ((code * 3) % 1200),
      ],
      pitchScale: vowel ? 1.05 : 0.92,
      durationScale: isKhmer ? 1.35 : isCjk ? 1.2 : vowel ? 1.1 : 0.85,
      voiced: vowel || isKhmer || isCjk || /[a-zA-Z\u1780-\u17FF]/.test(ch),
      pauseAfter: /[.!?។៕,]/.test(ch),
    });
  }
  if (!units.length) {
    units.push({
      formants: [400, 1200, 2400],
      pitchScale: 1,
      durationScale: 1,
      voiced: true,
      pauseAfter: false,
    });
  }
  return units;
}

function pitchFromDescription(desc: string | undefined, seed: number): number {
  let f0 = 140 + (seed % 40);
  if (!desc) return f0;
  const d = desc.toLowerCase();
  if (d.includes("woman") || d.includes("female") || d.includes("girl")) f0 = 195;
  if (d.includes("man") || d.includes("male") || d.includes("deep")) f0 = 115;
  if (d.includes("child") || d.includes("young")) f0 += 30;
  if (d.includes("elderly") || d.includes("soft")) f0 -= 15;
  return f0;
}

function envelope(n: number, dur: number): number {
  const a = Math.min(0.15, 40 / dur);
  const attack = Math.min(1, n / (dur * a));
  const release = Math.min(1, (dur - n) / (dur * 0.2));
  return attack * release;
}

function formant(source: number, t: number, freq: number, bw: number): number {
  // Lightweight resonant coloring of the source
  const w = 2 * Math.PI * freq;
  const damp = Math.exp(-bw * t * 0.002);
  return source * Math.cos(w * t) * damp + source;
}

export type { RuntimeStatus, RuntimeMemoryUsage, TTSResult };
