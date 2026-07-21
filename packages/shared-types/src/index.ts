/** Shared domain types for the local-first TTS studio. */

export type RuntimeBackend = "webgpu" | "wasm" | "hybrid" | "browser-speech" | "unavailable";

export type RuntimeStatusCode =
  | "idle"
  | "checking"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "cancelling"
  | "error"
  | "unsupported"
  | "insufficient-memory";

export interface RuntimeStatus {
  code: RuntimeStatusCode;
  backend: RuntimeBackend;
  label: string;
  detail?: string;
  progress?: number;
}

export interface RuntimeMemoryUsage {
  jsHeapUsedBytes?: number;
  jsHeapTotalBytes?: number;
  deviceMemoryGb?: number;
  estimatedModelBytes?: number;
}

export interface TTSAudioBuffer {
  /** PCM float32 mono samples */
  samples: Float32Array;
  sampleRate: number;
  channels: 1;
  durationSec: number;
}

export interface TTSResult {
  jobId: string;
  audio: TTSAudioBuffer;
  wavBytes: ArrayBuffer;
  providerId: string;
  backend: RuntimeBackend;
  seed?: number;
  createdAt: number;
  metadata?: Record<string, string | number | boolean>;
}

export type GenerationMode =
  | "text-to-speech"
  | "voice-design"
  | "voice-clone"
  | "high-fidelity-clone";

export type JobStatus =
  | "queued"
  | "preparing-text"
  | "loading-voice"
  | "generating"
  | "encoding-audio"
  | "completed"
  | "cancelled"
  | "failed";

export interface CompatibilityReport {
  tier: "recommended" | "compatible" | "limited" | "unsupported";
  webgpu: boolean;
  webgpuAdapter?: string;
  shaderF16?: boolean;
  wasmSimd: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  workers: boolean;
  opfs: boolean;
  storageEstimateBytes?: number;
  deviceMemoryGb?: number;
  browser: string;
  platform: string;
  details: string[];
}
