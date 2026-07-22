import { VOXCPM2_MANIFEST } from "@nd-os/model-storage";
import type {
  TTSGenerationCallbacks,
  TTSGenerationEstimate,
  TTSProvider,
  TTSProviderCapabilities,
  TTSProviderConfig,
  TTSProviderMetadata,
  TTSRequest,
  TTSValidationResult,
} from "@nd-os/tts-core";
import { countWords, estimateSpeechDurationSec } from "@nd-os/tts-core";
import type { VoxCPM2Runtime } from "@nd-os/voxcpm2-web-runtime";
import type { TTSResult } from "@nd-os/shared-types";
import { mapRequestToRuntime, VOXCPM2_DEFAULTS } from "./mapper";
import { validateVoxCPM2Request } from "./validation";
import { createStudioRuntime } from "./runtime-factory";

export const voxcpm2Metadata: TTSProviderMetadata = {
  id: "voxcpm2",
  name: "VoxCPM2 Browser",
  description:
    "Local tokenizer-free TTS with voice design and cloning. GGUF inference runs through CrispASR on WebGPU.",
  version: "2.0.0",
  runtime: "webgpu",
  supportedLanguages: [
    "en",
    "km",
    "zh",
    "ja",
    "ko",
    "th",
    "vi",
    "fr",
    "de",
    "es",
    "auto",
  ],
  capabilities: {
    textToSpeech: true,
    streaming: true,
    voiceDesign: true,
    voiceCloning: true,
    ultimateCloning: true,
    emotionControl: true,
    speedControl: true,
    batchGeneration: true,
  },
};

export function createVoxCPM2Provider(): TTSProvider {
  let runtime: VoxCPM2Runtime | null = null;
  let activeJobId: string | null = null;
  let initialized = false;

  async function getRuntime(): Promise<VoxCPM2Runtime> {
    if (!runtime) runtime = await createStudioRuntime();
    return runtime;
  }

  return {
    metadata: voxcpm2Metadata,

    async detectCapabilities(): Promise<TTSProviderCapabilities> {
      const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
      const wasm = typeof WebAssembly !== "undefined";
      const threads =
        typeof SharedArrayBuffer !== "undefined" &&
        typeof crossOriginIsolated !== "undefined" &&
        crossOriginIsolated;

      const available = webgpu && wasm && threads;

      return {
        available,
        backend: available ? "webgpu" : "unavailable",
        webgpu,
        wasm,
        threads,
        maxContextChars: 4000,
        supportedModes: [
          "text-to-speech",
          "voice-design",
          "voice-clone",
          "high-fidelity-clone",
        ],
        reason: available
          ? undefined
          : !webgpu
            ? "WebGPU is required for VoxCPM2 GGUF inference"
            : !threads
              ? "Cross-origin isolation is required for the threaded VoxCPM2 runtime"
              : "WebAssembly is required for VoxCPM2 Browser",
      };
    },

    async initialize(config: TTSProviderConfig) {
      if (runtime) await runtime.unload();
      runtime = await createStudioRuntime({ installedModelIds: config.modelIds });
      const rt = runtime;
      await rt.initialize({
        baselmPath: config.modelIds[0],
        acousticPath: config.modelIds[1],
        preferWebGpu: config.preferWebGpu,
        allowInterimEngine: true,
      });
      initialized = true;
    },

    async unload() {
      if (runtime) await runtime.unload();
      initialized = false;
      activeJobId = null;
    },

    getStatus() {
      // Runtime is constructed lazily inside getRuntime(); before initialize()
      // runs there's no status to report.
      if (!runtime) return null;
      return runtime.getStatus();
    },

    async validateRequest(request: TTSRequest): Promise<TTSValidationResult> {
      return validateVoxCPM2Request(request);
    },

    async estimateGeneration(request: TTSRequest): Promise<TTSGenerationEstimate> {
      const duration = estimateSpeechDurationSec(request.text);
      const words = countWords(request.text);
      return {
        estimatedDurationSec: duration,
        estimatedSeconds: Math.max(2, duration * 1.8),
        segmentCount: Math.max(1, Math.ceil(request.text.length / 280)),
        memoryHintMb: 512 + Math.min(2048, words * 2),
      };
    },

    async generate(
      request: TTSRequest,
      callbacks?: TTSGenerationCallbacks,
    ): Promise<TTSResult> {
      if (!initialized) {
        await this.initialize({
          modelIds: [],
          preferWebGpu: true,
        });
      }
      activeJobId = request.jobId;
      const mapped = mapRequestToRuntime(request, VOXCPM2_DEFAULTS);
      const rt = await getRuntime();
      try {
        return await rt.generateStream(mapped, {
          onProgress: callbacks?.onProgress,
        });
      } finally {
        if (activeJobId === request.jobId) activeJobId = null;
      }
    },

    async cancel(jobId: string) {
      if ((activeJobId === jobId || activeJobId === null) && runtime) {
        await runtime.cancel();
      }
    },
  };
}

export { VOXCPM2_DEFAULTS, mapRequestToRuntime } from "./mapper";
export type { VoxCPM2AdvancedSettings } from "./mapper";
export { validateVoxCPM2Request } from "./validation";
export { VOXCPM2_MANIFEST };
