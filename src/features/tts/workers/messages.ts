/** Typed worker message contracts for TTS studio workers. */

export type RuntimeWorkerRequest =
  | { type: "init"; jobId: string; allowInterimEngine?: boolean }
  | { type: "generate"; jobId: string; text: string; seed?: number }
  | { type: "cancel"; jobId: string }
  | { type: "unload" };

export type RuntimeWorkerResponse =
  | { type: "status"; label: string; progress?: number }
  | { type: "result"; jobId: string; wavBytes: ArrayBuffer; sampleRate: number; durationSec: number }
  | { type: "error"; jobId?: string; message: string };

export type AudioWorkerRequest =
  | { type: "encode-wav"; samples: Float32Array; sampleRate: number }
  | { type: "merge"; segments: ArrayBuffer[]; pauseSec: number; sampleRate: number };

export type ModelDownloadWorkerRequest =
  | { type: "download"; url: string; filename: string; expectedBytes?: number }
  | { type: "cancel"; filename: string };

export type WaveformWorkerRequest = {
  type: "peaks";
  samples: Float32Array;
  bars?: number;
};
