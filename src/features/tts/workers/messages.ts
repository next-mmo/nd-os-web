/** Typed worker message contracts for TTS studio workers. */

export type RuntimeWorkerRequest =
  | {
      type: "init";
      jobId: string;
      allowInterimEngine?: boolean;
      baselmPath?: string;
      acousticPath?: string;
      preferWebGpu?: boolean;
      sampleRate?: number;
    }
  | {
      type: "generate";
      jobId: string;
      text: string;
      mode?: "tts" | "voice-design" | "voice-clone" | "hf-clone";
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

export type RuntimeWorkerResponse =
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
