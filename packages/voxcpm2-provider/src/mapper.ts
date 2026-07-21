import type { TTSRequest } from "@nd-os/tts-core";
import type { VoxCPM2GenerateRequest } from "@nd-os/voxcpm2-web-runtime";

export const VOXCPM2_DEFAULTS = {
  guidance: 2.0,
  timesteps: 10,
  temperature: 1.0,
  seed: 42,
};

export type VoxCPM2AdvancedSettings = typeof VOXCPM2_DEFAULTS;

export function mapRequestToRuntime(
  request: TTSRequest,
  defaults: VoxCPM2AdvancedSettings = VOXCPM2_DEFAULTS,
): VoxCPM2GenerateRequest {
  const modeMap = {
    "text-to-speech": "tts",
    "voice-design": "voice-design",
    "voice-clone": "voice-clone",
    "high-fidelity-clone": "hf-clone",
  } as const;

  return {
    jobId: request.jobId,
    text: request.text,
    mode: modeMap[request.mode],
    voiceDescription: request.voice?.description,
    referenceTranscript: request.voice?.referenceTranscript,
    styleInstruction: request.voice?.styleInstruction,
    seed: request.seed ?? defaults.seed,
    guidance: request.guidance ?? defaults.guidance,
    timesteps: request.timesteps ?? defaults.timesteps,
    temperature: request.temperature ?? defaults.temperature,
  };
}
