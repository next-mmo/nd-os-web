import type { GenerationMode, TTSResult } from "@nd-os/shared-types";

export interface TTSProviderMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: "webgpu" | "wasm" | "hybrid";
  supportedLanguages: string[];
  capabilities: {
    textToSpeech: boolean;
    streaming: boolean;
    voiceDesign: boolean;
    voiceCloning: boolean;
    ultimateCloning: boolean;
    emotionControl: boolean;
    speedControl: boolean;
    batchGeneration: boolean;
  };
}

export interface TTSProviderCapabilities {
  available: boolean;
  backend: "webgpu" | "wasm" | "hybrid" | "browser-speech" | "unavailable";
  reason?: string;
  webgpu: boolean;
  wasm: boolean;
  threads: boolean;
  maxContextChars: number;
  supportedModes: GenerationMode[];
}

export interface TTSProviderConfig {
  modelIds: string[];
  preferWebGpu?: boolean;
  threadCount?: number;
}

export interface TTSVoiceRef {
  id: string;
  name: string;
  mode: GenerationMode;
  description?: string;
  referenceAudioPath?: string;
  referenceTranscript?: string;
  styleInstruction?: string;
  consentConfirmed?: boolean;
}

export interface TTSRequest {
  jobId: string;
  text: string;
  mode: GenerationMode;
  voice?: TTSVoiceRef;
  language?: string;
  seed?: number;
  guidance?: number;
  timesteps?: number;
  temperature?: number;
  speed?: number;
}

export interface TTSValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface TTSGenerationEstimate {
  estimatedDurationSec: number;
  estimatedSeconds: number;
  segmentCount: number;
  memoryHintMb: number;
}

export interface TTSGenerationCallbacks {
  onProgress?: (progress: number, message: string) => void;
  onSegment?: (index: number, total: number) => void;
}

export interface TTSProvider {
  readonly metadata: TTSProviderMetadata;

  detectCapabilities(): Promise<TTSProviderCapabilities>;
  initialize(config: TTSProviderConfig): Promise<void>;
  unload(): Promise<void>;

  validateRequest(request: TTSRequest): Promise<TTSValidationResult>;
  estimateGeneration(request: TTSRequest): Promise<TTSGenerationEstimate>;

  generate(
    request: TTSRequest,
    callbacks?: TTSGenerationCallbacks,
  ): Promise<TTSResult>;

  cancel(jobId: string): Promise<void>;
}

export type TextSegment = {
  id: string;
  text: string;
  enabled: boolean;
  order: number;
};

const SENTENCE_RE = /[^.!?។៕…]+[.!?។៕…]+\s*|[^.!?។៕…]+$/gu;

/** Split text into segments without breaking words; preserves Khmer and CJK. */
export function splitIntoSegments(text: string, maxChars = 280): TextSegment[] {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];

  const sentences = trimmed.match(SENTENCE_RE) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (!current) {
      current = piece;
      continue;
    }
    if (current.length + 1 + piece.length <= maxChars) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);

  // Hard-wrap oversized chunks on whitespace / punctuation boundaries.
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      final.push(chunk);
      continue;
    }
    let rest = chunk;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < maxChars * 0.4) cut = maxChars;
      final.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) final.push(rest);
  }

  return final.map((t, i) => ({
    id: `seg-${i}-${hashShort(t)}`,
    text: t,
    enabled: true,
    order: i,
  }));
}

export function countWords(text: string): number {
  const khmer = text.match(/[\u1780-\u17FF]+/g)?.length ?? 0;
  const latin = text
    .replace(/[\u1780-\u17FF]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return khmer + latin;
}

export function estimateSpeechDurationSec(text: string): number {
  // ~12 chars/sec multilingual average; Khmer slightly slower.
  const khmerRatio = (text.match(/[\u1780-\u17FF]/g)?.length ?? 0) / Math.max(1, text.length);
  const cps = 12 - khmerRatio * 3;
  return Math.max(0.4, text.trim().length / cps);
}

function hashShort(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

export function cleanPastedText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
