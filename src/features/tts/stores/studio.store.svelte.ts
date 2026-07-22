import type { CompatibilityReport, RuntimeStatus } from "@nd-os/shared-types";
import type { GenerationMode } from "@nd-os/shared-types";
import type { TextSegment } from "@nd-os/tts-core";
import {
  cleanPastedText,
  countWords,
  estimateSpeechDurationSec,
  splitIntoSegments,
} from "@nd-os/tts-core";
import { downloadArrayBuffer, encodeWavMono, mergeSegments } from "@nd-os/audio-engine";
import { writeOpfsFile } from "@nd-os/model-storage";
import { bootstrapProviders, providerRegistry } from "@/features/providers";
import { VOXCPM2_DEFAULTS } from "@/features/providers/providers/voxcpm2/voxcpm2.provider";
import {
  ensureDefaultSettings,
  ttsDb,
  type JobRecord,
  type ProjectRecord,
  type VoiceRecord,
} from "@/features/tts/db/tts-db";
import { runCompatibilityCheck } from "@/features/tts/compatibility/check";

export type StudioView =
  | "studio"
  | "voices"
  | "batch"
  | "history"
  | "models"
  | "settings"
  | "compatibility";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

const SAMPLE_TEXT =
  "សួស្តី! Welcome to AI TTS Studio. Generate speech locally on your device.";

class StudioStore {
  ready = $state(false);
  view = $state<StudioView>("studio");
  sidebarCollapsed = $state(false);

  projects = $state<ProjectRecord[]>([]);
  currentProjectId = $state<string | null>(null);
  saveStatus = $state<"idle" | "saving" | "saved">("saved");

  voices = $state<VoiceRecord[]>([]);
  selectedVoiceId = $state<string | null>(null);

  providerId = $state("voxcpm2");
  mode = $state<GenerationMode>("text-to-speech");
  text = $state(SAMPLE_TEXT);
  segments = $state<TextSegment[]>([]);
  voiceDescription = $state("");
  styleInstruction = $state("");
  consentChecked = $state(false);
  referenceTranscript = $state("");

  advanced = $state({ ...VOXCPM2_DEFAULTS });
  showAdvanced = $state(false);

  runtimeStatus = $state<RuntimeStatus>({
    code: "idle",
    backend: "unavailable",
    label: "VoxCPM2 idle",
  });
  compatibility = $state<CompatibilityReport | null>(null);
  showCompatGate = $state(false);

  jobs = $state<JobRecord[]>([]);
  activeJobId = $state<string | null>(null);
  generating = $state(false);

  previewUrl = $state<string | null>(null);
  previewPeaks = $state<number[]>([]);
  lastWav = $state<ArrayBuffer | null>(null);
  lastDuration = $state(0);

  error = $state<string | null>(null);
  errorAction = $state<string | null>(null);

  get currentProject(): ProjectRecord | null {
    return this.projects.find((p) => p.id === this.currentProjectId) ?? null;
  }

  get charCount(): number {
    return this.text.length;
  }

  get wordCount(): number {
    return countWords(this.text);
  }

  get estimatedDuration(): number {
    return estimateSpeechDurationSec(this.text);
  }

  get selectedVoice(): VoiceRecord | null {
    return this.voices.find((v) => v.id === this.selectedVoiceId) ?? null;
  }

  async boot() {
    bootstrapProviders();
    await ensureDefaultSettings();
    this.compatibility = await runCompatibilityCheck();
    const settings = await ttsDb.settings.get("app");
    if (settings?.showCompatibilityOnLaunch) {
      this.showCompatGate = true;
    }

    this.projects = await ttsDb.projects.orderBy("updatedAt").reverse().toArray();
    this.voices = await ttsDb.voices.orderBy("lastUsedAt").reverse().toArray();

    // A page reload terminates the inference worker, so persisted in-flight
    // jobs cannot still be running. Reconcile them before rendering the queue
    // instead of leaving permanent "generating" rows after a restart.
    const interruptedJobs = await ttsDb.jobs
      .where("status")
      .anyOf(["queued", "preparing-text", "loading-voice", "generating", "encoding-audio"])
      .toArray();
    if (interruptedJobs.length) {
      const completedAt = Date.now();
      await ttsDb.jobs.bulkPut(
        interruptedJobs.map((job) => ({
          ...job,
          status: "cancelled" as const,
          message: "Interrupted by page reload",
          completedAt,
          elapsedMs: Math.max(0, completedAt - job.createdAt),
        })),
      );
    }
    this.jobs = await ttsDb.jobs.orderBy("createdAt").reverse().limit(50).toArray();

    if (!this.projects.length) {
      await this.newProject("Untitled Project");
    } else {
      await this.openProject(this.projects[0]!.id);
    }

    if (!this.voices.length) {
      await this.createVoice({
        name: "Default Studio Voice",
        mode: "text-to-speech",
        description: "A calm clear multilingual narrator",
      });
    } else if (!this.selectedVoiceId) {
      this.selectedVoiceId = this.voices[0]!.id;
    }

    this.view = "studio";

    await this.reloadProviderRuntime();

    this.ready = true;
  }

  /** Rebuild the provider after a model import/download/delete. */
  async reloadProviderRuntime() {
    // The provider reports the backend that actually loaded (GGUF WASM or
    // interim DSP); surface it directly rather than inferring from WebGPU.
    try {
      const provider = providerRegistry.get(this.providerId);
      if (provider) {
        this.runtimeStatus = {
          code: "loading",
          backend: "unavailable",
          label: "Loading model",
        };
        // Refresh inventory so the factory can select any installed complete
        // GGUF quantization or fall back to interim DSP.
        const { providerModelManager } = await import("@/features/providers");
        await providerModelManager.refreshInstalled("voxcpm2");
        const installed = providerModelManager.listInstalled();
        const initialize = provider.initialize({
          modelIds: installed.map((m) => m.id),
          preferWebGpu: true,
        });
        const poll = globalThis.setInterval(() => {
          const loadingStatus = provider.getStatus?.();
          if (loadingStatus) this.runtimeStatus = loadingStatus;
        }, 250);
        try {
          await initialize;
        } finally {
          globalThis.clearInterval(poll);
        }
        // The runtime knows what actually loaded — ask it, don't guess.
        // Falls back to a generic "ready" if the provider doesn't expose status.
        const status = provider.getStatus?.();
        if (status) {
          this.runtimeStatus = status;
        } else {
          this.runtimeStatus = {
            code: "ready",
            backend: "unavailable",
            label: "Ready",
            detail:
              installed.length > 0
                ? `${installed.length} model(s) installed.`
                : "Import or download a VoxCPM2 GGUF in Model Manager for neural synthesis.",
          };
        }
      }
    } catch (err) {
      this.runtimeStatus = {
        code: "error",
        backend: "unavailable",
        label: "Runtime error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

  }

  async newProject(name = "Untitled Project") {
    const project: ProjectRecord = {
      id: uid("proj"),
      name,
      text: SAMPLE_TEXT,
      providerId: this.providerId,
      voiceId: this.selectedVoiceId ?? undefined,
      mode: "text-to-speech",
      advanced: { ...this.advanced },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await ttsDb.projects.put(project);
    this.projects = [project, ...this.projects];
    await this.openProject(project.id);
  }

  async openProject(id: string) {
    const project = await ttsDb.projects.get(id);
    if (!project) return;
    this.currentProjectId = id;
    this.text = project.text;
    this.providerId = project.providerId;
    this.mode = project.mode;
    this.advanced = { ...VOXCPM2_DEFAULTS, ...project.advanced };
    this.selectedVoiceId =
      project.voiceId ?? this.selectedVoiceId ?? this.voices[0]?.id ?? null;
    this.resyncSegments();
    this.view = "studio";
  }

  async saveProject() {
    if (!this.currentProjectId) return;
    this.saveStatus = "saving";
    const existing = await ttsDb.projects.get(this.currentProjectId);
    if (!existing) return;
    const next: ProjectRecord = {
      ...existing,
      name: existing.name,
      text: this.text,
      providerId: this.providerId,
      voiceId: this.selectedVoiceId ?? undefined,
      mode: this.mode,
      advanced: { ...this.advanced },
      updatedAt: Date.now(),
    };
    await ttsDb.projects.put(next);
    this.projects = this.projects.map((p) => (p.id === next.id ? next : p));
    this.saveStatus = "saved";
  }

  scheduleAutosave() {
    this.saveStatus = "saving";
    window.clearTimeout((this as unknown as { _saveTimer?: number })._saveTimer);
    (this as unknown as { _saveTimer?: number })._saveTimer = window.setTimeout(() => {
      void this.saveProject();
    }, 500);
  }

  setText(value: string) {
    this.text = value;
    this.resyncSegments();
    this.scheduleAutosave();
  }

  pasteClean(value: string) {
    this.setText(cleanPastedText(value));
  }

  resyncSegments() {
    this.segments = splitIntoSegments(this.text);
  }

  async renameProject(name: string) {
    if (!this.currentProjectId) return;
    const existing = await ttsDb.projects.get(this.currentProjectId);
    if (!existing) return;
    const next = { ...existing, name, updatedAt: Date.now() };
    await ttsDb.projects.put(next);
    this.projects = this.projects.map((p) => (p.id === next.id ? next : p));
  }

  async createVoice(input: {
    name: string;
    mode: GenerationMode;
    description?: string;
  }) {
    const voice: VoiceRecord = {
      id: uid("voice"),
      name: input.name,
      providerId: this.providerId,
      mode: input.mode,
      description: input.description,
      favorite: false,
      consentConfirmed: false,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    await ttsDb.voices.put(voice);
    this.voices = [voice, ...this.voices];
    this.selectedVoiceId = voice.id;
    return voice;
  }

  async deleteVoice(id: string) {
    await ttsDb.voices.delete(id);
    this.voices = this.voices.filter((v) => v.id !== id);
    if (this.selectedVoiceId === id) this.selectedVoiceId = this.voices[0]?.id ?? null;
  }

  resetAdvanced() {
    this.advanced = { ...VOXCPM2_DEFAULTS };
    this.scheduleAutosave();
  }

  async generate() {
    this.error = null;
    this.errorAction = null;
    const provider = providerRegistry.get(this.providerId);
    if (!provider) {
      this.error = "Provider not found";
      return;
    }

    const voice = this.selectedVoice;
    const jobId = uid("job");
    const request = {
      jobId,
      text: this.text,
      mode: this.mode,
      voice: voice
        ? {
            id: voice.id,
            name: voice.name,
            mode: this.mode,
            description:
              this.mode === "voice-design"
                ? this.voiceDescription || voice.description
                : voice.description,
            referenceAudioPath: voice.referenceAudioPath,
            referenceTranscript: this.referenceTranscript || voice.referenceTranscript,
            styleInstruction: this.styleInstruction || voice.styleInstruction,
            consentConfirmed: this.consentChecked || voice.consentConfirmed,
          }
        : {
            id: "default",
            name: "Default",
            mode: this.mode,
            description: this.voiceDescription || undefined,
            consentConfirmed: this.consentChecked,
            referenceTranscript: this.referenceTranscript || undefined,
            styleInstruction: this.styleInstruction || undefined,
          },
      seed: this.advanced.seed,
      guidance: this.advanced.guidance,
      timesteps: this.advanced.timesteps,
      temperature: this.advanced.temperature,
    };

    const validation = await provider.validateRequest(request);
    if (!validation.ok) {
      this.error = validation.errors.join(" ");
      this.errorAction = "Fix inputs";
      return;
    }

    const job: JobRecord = {
      id: jobId,
      projectId: this.currentProjectId ?? "none",
      providerId: this.providerId,
      status: "queued",
      text: this.text,
      mode: this.mode,
      progress: 0,
      message: "Queued",
      createdAt: Date.now(),
    };
    await ttsDb.jobs.put(job);
    this.jobs = [job, ...this.jobs];
    this.activeJobId = jobId;
    this.generating = true;
    const generationBackend = provider.getStatus?.()?.backend ?? this.runtimeStatus.backend;
    this.runtimeStatus = {
      code: "generating",
      backend: generationBackend,
      label: "Generating",
      progress: 0,
    };

    const started = performance.now();
    try {
      await this.patchJob(jobId, { status: "preparing-text", message: "Preparing text", progress: 0.05 });
      const result = await provider.generate(request, {
        onProgress: (progress, message) => {
          this.runtimeStatus = {
            code: "generating",
            backend: provider.getStatus?.()?.backend ?? generationBackend,
            label: message,
            progress,
          };
          void this.patchJob(jobId, {
            status: progress > 0.9 ? "encoding-audio" : "generating",
            progress,
            message,
          });
        },
      });

      const filename = `${jobId}.wav`;
      await writeOpfsFile("audio", filename, result.wavBytes);
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = URL.createObjectURL(new Blob([result.wavBytes], { type: "audio/wav" }));
      this.lastWav = result.wavBytes;
      this.lastDuration = result.audio.durationSec;

      const peaks: number[] = [];
      const samples = result.audio.samples;
      const bars = 64;
      const block = Math.max(1, Math.floor(samples.length / bars));
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        const start = i * block;
        const end = Math.min(samples.length, start + block);
        for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]!));
        peaks.push(peak);
      }
      this.previewPeaks = peaks;

      await this.patchJob(jobId, {
        status: "completed",
        progress: 1,
        message: "Completed",
        audioPath: `audio/${filename}`,
        durationSec: result.audio.durationSec,
        backend: result.backend,
        completedAt: Date.now(),
        elapsedMs: Math.round(performance.now() - started),
      });

      this.runtimeStatus = {
        code: "ready",
        backend: result.backend,
        label: result.backend === "webgpu" ? "VoxCPM2 ready · WebGPU" : "VoxCPM2 ready",
      };
      await this.saveProject();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      await this.patchJob(jobId, {
        status: cancelled ? "cancelled" : "failed",
        error: message,
        message: cancelled ? "Cancelled" : message,
        completedAt: Date.now(),
        elapsedMs: Math.round(performance.now() - started),
      });
      this.error = cancelled ? "Generation cancelled" : message;
      this.errorAction = cancelled ? null : "Retry";
      this.runtimeStatus = {
        code: cancelled ? "ready" : "error",
        backend: provider.getStatus?.()?.backend ?? generationBackend,
        label: cancelled ? "VoxCPM2 ready" : "Generation failed",
        detail: message,
      };
    } finally {
      this.generating = false;
      this.activeJobId = null;
    }
  }

  async cancel() {
    if (!this.activeJobId) return;
    const provider = providerRegistry.get(this.providerId);
    await provider?.cancel(this.activeJobId);
  }

  downloadLast() {
    if (!this.lastWav) return;
    const name = `${this.currentProject?.name ?? "speech"}-${Date.now()}.wav`;
    downloadArrayBuffer(name.replace(/\s+/g, "-"), this.lastWav, "audio/wav");
  }

  async clearAllLocalData() {
    await ttsDb.delete();
    location.reload();
  }

  dismissCompatGate() {
    this.showCompatGate = false;
    void ttsDb.settings.update("app", { showCompatibilityOnLaunch: false });
  }

  private async patchJob(id: string, patch: Partial<JobRecord>) {
    const existing = await ttsDb.jobs.get(id);
    if (!existing) return;
    const next = { ...existing, ...patch };
    await ttsDb.jobs.put(next);
    this.jobs = this.jobs.map((j) => (j.id === id ? next : j));
  }
}

export const studioStore = new StudioStore();

// silence unused import warning if tree-shaken oddly
void encodeWavMono;
void mergeSegments;
