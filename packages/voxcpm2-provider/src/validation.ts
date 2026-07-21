import type { TTSRequest, TTSValidationResult } from "@nd-os/tts-core";

export function validateVoxCPM2Request(request: TTSRequest): TTSValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!request.text?.trim()) {
    errors.push("Enter text to generate speech.");
  }
  if (request.text.length > 8000) {
    errors.push("Text is too long. Split into segments under 8,000 characters.");
  }
  if (request.mode === "voice-clone" || request.mode === "high-fidelity-clone") {
    if (!request.voice?.consentConfirmed) {
      errors.push(
        "Confirm you own this voice or have permission before cloning.",
      );
    }
    if (!request.voice?.referenceAudioPath) {
      errors.push("Reference audio is required for voice cloning.");
    }
  }
  if (request.mode === "high-fidelity-clone" && !request.voice?.referenceTranscript?.trim()) {
    errors.push(
      "High-fidelity clone needs an exact transcript of the reference audio.",
    );
  }
  if (request.mode === "voice-design" && !request.voice?.description?.trim()) {
    warnings.push("Add a voice description for better voice design results.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
