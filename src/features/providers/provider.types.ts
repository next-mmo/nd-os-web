import type { TTSProvider } from "@nd-os/tts-core";

export type {
  TTSProvider,
  TTSProviderMetadata,
  TTSProviderCapabilities,
  TTSProviderConfig,
  TTSRequest,
  TTSValidationResult,
  TTSGenerationEstimate,
  TTSGenerationCallbacks,
  TTSVoiceRef,
  TextSegment,
} from "@nd-os/tts-core";

export {
  splitIntoSegments,
  countWords,
  estimateSpeechDurationSec,
  cleanPastedText,
} from "@nd-os/tts-core";
