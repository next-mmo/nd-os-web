import Dexie, { type EntityTable } from "dexie";
import type { GenerationMode, JobStatus } from "@nd-os/shared-types";

export type ProjectRecord = {
  id: string;
  name: string;
  text: string;
  providerId: string;
  voiceId?: string;
  mode: GenerationMode;
  advanced: Record<string, number>;
  createdAt: number;
  updatedAt: number;
};

export type VoiceRecord = {
  id: string;
  name: string;
  providerId: string;
  mode: GenerationMode;
  description?: string;
  referenceAudioPath?: string;
  referenceTranscript?: string;
  styleInstruction?: string;
  favorite: boolean;
  consentConfirmed: boolean;
  consentAt?: number;
  createdAt: number;
  lastUsedAt?: number;
  previewAudioPath?: string;
};

export type JobRecord = {
  id: string;
  projectId: string;
  providerId: string;
  status: JobStatus;
  text: string;
  mode: GenerationMode;
  progress: number;
  message?: string;
  error?: string;
  audioPath?: string;
  durationSec?: number;
  backend?: string;
  createdAt: number;
  completedAt?: number;
  elapsedMs?: number;
};

export type SettingsRecord = {
  id: "app";
  theme: "light" | "dark" | "system";
  lastProviderId: string;
  segmentPauseSec: number;
  showCompatibilityOnLaunch: boolean;
  advancedDefaults: Record<string, number>;
};

export type ModelMetaRecord = {
  id: string;
  providerId: string;
  name: string;
  path: string;
  bytes: number;
  version: string;
  lastUsedAt?: number;
};

class TtsDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, "id">;
  voices!: EntityTable<VoiceRecord, "id">;
  jobs!: EntityTable<JobRecord, "id">;
  settings!: EntityTable<SettingsRecord, "id">;
  models!: EntityTable<ModelMetaRecord, "id">;

  constructor() {
    super("nd-os-tts-studio");
    this.version(1).stores({
      projects: "id, updatedAt, name",
      voices: "id, providerId, lastUsedAt, favorite",
      jobs: "id, projectId, createdAt, status",
      settings: "id",
      models: "id, providerId",
    });
  }
}

export const ttsDb = new TtsDatabase();

export async function ensureDefaultSettings(): Promise<SettingsRecord> {
  const existing = await ttsDb.settings.get("app");
  if (existing) return existing;
  const defaults: SettingsRecord = {
    id: "app",
    theme: "system",
    lastProviderId: "voxcpm2",
    segmentPauseSec: 0.25,
    showCompatibilityOnLaunch: true,
    advancedDefaults: {
      guidance: 2,
      timesteps: 10,
      temperature: 1,
      seed: 42,
    },
  };
  await ttsDb.settings.put(defaults);
  return defaults;
}
