/**
 * Mock VoxCPM2 engine adapter. Satisfies the same {@link VoxCPM2EngineAdapter}
 * contract as the ORT adapter but produces deterministic synthetic PCM, so the
 * runtime pipeline can be unit-tested end-to-end without ONNX artifacts.
 *
 * Not intended for production — it sounds like a buzzer, not speech. But it
 * exercises every code path the real adapter does (load → synthesize(full req)
 * → unload, cancellation, progress), and records forwarded params for asserts.
 */

import type { VoxCPM2GenerateRequest } from "./index";
import type { VoxCPM2EngineAdapter } from "./ort-adapter";

export interface MockAdapterOptions {
  sampleRate?: number;
  onProgress?: (progress: number, message: string) => void;
  isCancelled?: () => boolean;
}

export interface RecordedSynthesizeCall {
  text: string;
  mode?: string;
  seed?: number;
  guidance?: number;
  timesteps?: number;
  temperature?: number;
  voiceDescription?: string;
  referenceTranscript?: string;
  hasReferencePcm: boolean;
}

export function createMockAdapter(options: MockAdapterOptions = {}): VoxCPM2EngineAdapter & {
  /** Test inspectability: every synthesize() call is recorded here in order. */
  readonly calls: RecordedSynthesizeCall[];
} {
  const sampleRate = options.sampleRate ?? 48000;
  const calls: RecordedSynthesizeCall[] = [];
  let loaded = false;

  return {
    async load() {
      options.onProgress?.(0.1, "Loading BaseLM (mock)");
      options.onProgress?.(0.4, "Loading Acoustic (mock)");
      loaded = true;
    },

    async synthesize(request) {
      if (!loaded) throw new Error("Adapter not loaded");
      calls.push({
        text: request.text,
        mode: request.mode,
        seed: request.seed,
        guidance: request.guidance,
        timesteps: request.timesteps,
        temperature: request.temperature,
        voiceDescription: request.voiceDescription,
        referenceTranscript: request.referenceTranscript,
        hasReferencePcm: Boolean(request.referencePcm?.length),
      });

      const timesteps = request.timesteps ?? 10;
      options.onProgress?.(0.55, `Running BaseLM (mock, ${timesteps} steps)`);

      // Deterministic, non-silent PCM whose duration scales with text length
      // and timesteps — mirrors what the real graph would produce.
      const textLen = Math.max(1, request.text.length);
      const secondsPerChar = 0.045;
      const totalSeconds = textLen * secondsPerChar * (timesteps / 10);
      const n = Math.floor(totalSeconds * sampleRate);
      const out = new Float32Array(n);

      let phase = 0;
      const f0 = 140 + ((request.seed ?? 42) % 40);
      for (let i = 0; i < n; i++) {
        if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");
        phase += (2 * Math.PI * f0) / sampleRate;
        const env = Math.min(1, i / (sampleRate * 0.01)) * Math.min(1, (n - i) / (sampleRate * 0.05));
        out[i] = Math.sin(phase) * 0.3 * env;
        if (i % 4096 === 0) await Promise.resolve(); // yield
      }

      options.onProgress?.(0.82, "Decoding audio (mock)");
      options.onProgress?.(1, "Completed");
      return out;
    },

    async unload() {
      loaded = false;
    },

    get backend() {
      return "wasm" as const;
    },

    get calls() {
      return calls;
    },
  };
}
