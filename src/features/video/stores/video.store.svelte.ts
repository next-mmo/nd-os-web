import {
  TOOLS,
  buildCommand,
  createZip,
  defaultValues,
  fileExtension,
  fileStem,
  readFontFamily,
  UnsupportedFontError,
  type BuildContext,
  type JobArtifact,
  type MediaInfo,
  type OptionValues,
  type ToolId,
  type VideoJob,
} from "@nd-os/video-engine";
import {
  JobCancelledError,
  LARGE_INPUT_WARN_BYTES,
  videoRuntime,
} from "@/features/video/ffmpeg/runtime";
import { deleteFont, listFonts, saveFont, type FontRecord } from "@/features/video/db/video-db";

export type EngineState = "idle" | "loading" | "ready" | "error";

type SourceSlot = {
  file: File;
  path: string;
  info: MediaInfo | null;
  /** Runtime generation this file was last written under. */
  writtenAt: number;
};

const FONT_DIR = "fonts";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function safeExt(file: File, fallback: string): string {
  const ext = fileExtension(file.name);
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}

class VideoStore {
  engineState = $state<EngineState>("idle");
  engineError = $state<string | null>(null);

  toolId = $state<ToolId>("convert");
  /** Kept per tool so switching back and forth does not lose settings. */
  valuesByTool = $state<Partial<Record<ToolId, OptionValues>>>({});

  source = $state<SourceSlot | null>(null);
  clips = $state<SourceSlot[]>([]);
  extras = $state<Record<string, SourceSlot>>({});

  fonts = $state<FontRecord[]>([]);
  selectedFontId = $state<string | null>(null);

  jobs = $state<VideoJob[]>([]);
  running = $state(false);
  probing = $state(false);
  notice = $state<string | null>(null);

  /** Monotonic so removing and re-adding clips can never reuse a path. */
  #clipSeq = 0;
  #lastProgressAt = 0;
  #enginePromise: Promise<void> | null = null;

  get tool() {
    return TOOLS[this.toolId];
  }

  get values(): OptionValues {
    return this.valuesByTool[this.toolId] ?? defaultValues(this.toolId);
  }

  get info(): MediaInfo | null {
    return this.source?.info ?? null;
  }

  get selectedFont(): FontRecord | null {
    return this.fonts.find((f) => f.id === this.selectedFontId) ?? null;
  }

  get activeJob(): VideoJob | null {
    return this.jobs.find((j) => j.status === "running") ?? null;
  }

  /** The `-i` files a run needs, in the order the builder expects them. */
  get inputSlots(): SourceSlot[] {
    const slots = this.tool.multiClip ? [...this.clips] : this.source ? [this.source] : [];
    return [...slots, ...Object.values(this.extras)];
  }

  /**
   * Why the run button is disabled, or null when the job is ready to go.
   * Doubles as the inline validation message.
   */
  get blockedReason(): string | null {
    if (this.engineState === "error") return this.engineError;
    if (this.running) return "A job is already running.";
    if (this.probing) return "Still reading the file…";

    if (this.tool.multiClip) {
      if (this.clips.length < 2) return "Add at least two clips.";
    } else if (!this.source) {
      return "Add a file to get started.";
    }

    const info = this.info;
    if (!this.tool.multiClip && info) {
      if (this.tool.accepts === "video" && !info.hasVideo) {
        return `${this.tool.title} needs a file with a video track.`;
      }
      if (this.tool.accepts === "audio" && !info.hasAudio) {
        return `${this.tool.title} needs a file with an audio track.`;
      }
    }

    for (const extra of this.tool.extras ?? []) {
      if (extra.role === "font") {
        const needsFont =
          this.toolId === "subtitles" ||
          (this.toolId === "watermark" && this.values.kind === "text");
        if (needsFont && !this.selectedFont) return "Choose a font file for the text.";
        continue;
      }
      if (extra.required && !this.extras[extra.id]) return `Add ${extra.label.toLowerCase()}.`;
    }

    // Surface builder-level problems (bad ranges, impossible targets) up front
    // rather than after the user commits to a run.
    try {
      this.#buildPlan();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return null;
  }

  get planWarnings(): string[] {
    try {
      return this.#buildPlan().warnings;
    } catch {
      return [];
    }
  }

  async boot() {
    this.fonts = await listFonts();
    this.selectedFontId = this.fonts[0]?.id ?? null;
  }

  /**
   * Callers must await the *same* load, not bail out because one is already in
   * flight — otherwise the second caller sees a not-ready engine and reports a
   * failure that never happened.
   */
  async ensureEngine(): Promise<void> {
    if (this.engineState === "ready") return;
    if (!this.#enginePromise) {
      this.engineState = "loading";
      this.engineError = null;
      this.#enginePromise = videoRuntime
        .load()
        .then(() => {
          this.engineState = "ready";
        })
        .catch((err: unknown) => {
          this.engineState = "error";
          this.engineError = err instanceof Error ? err.message : String(err);
        })
        .finally(() => {
          this.#enginePromise = null;
        });
    }
    await this.#enginePromise;
  }

  setTool(id: ToolId) {
    this.toolId = id;
    if (!this.valuesByTool[id]) this.valuesByTool[id] = defaultValues(id);
    this.notice = null;
    // Options that only exist for the previous tool would otherwise linger.
    for (const key of Object.keys(this.extras)) {
      if (!(TOOLS[id].extras ?? []).some((e) => e.id === key)) {
        delete this.extras[key];
      }
    }
  }

  setValue(id: string, value: string | number | boolean) {
    const current = this.valuesByTool[this.toolId] ?? defaultValues(this.toolId);
    this.valuesByTool[this.toolId] = { ...current, [id]: value };
  }

  resetValues() {
    this.valuesByTool[this.toolId] = defaultValues(this.toolId);
  }

  async setSource(file: File) {
    this.notice = null;
    const slot = await this.#tryAdopt(file, "src");
    if (!slot) return;
    this.source = slot;
    if (file.size > LARGE_INPUT_WARN_BYTES) {
      this.notice =
        "That file is large. Everything runs in this tab's memory, so very long or high-bitrate sources may run out of room.";
    }
  }

  async addClips(files: File[]) {
    this.notice = null;
    for (const file of files) {
      const slot = await this.#tryAdopt(file, `clip${this.#clipSeq++}`);
      if (!slot) break;
      this.clips = [...this.clips, slot];
    }
    if (!this.source && this.clips.length) this.source = this.clips[0]!;
  }

  removeClip(index: number) {
    this.clips = this.clips.filter((_, i) => i !== index);
    this.source = this.clips[0] ?? null;
  }

  moveClip(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= this.clips.length) return;
    const next = [...this.clips];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    this.clips = next;
    this.source = this.clips[0] ?? null;
  }

  async setExtra(id: string, file: File) {
    this.notice = null;
    const spec = (this.tool.extras ?? []).find((e) => e.id === id);
    if (spec?.role === "font") {
      await this.#addFont(file);
      return;
    }
    // Images and subtitle files have no streams worth probing.
    const probe = spec?.role === "audio";
    const slot = await this.#tryAdopt(file, `extra_${id}`, probe);
    if (slot) this.extras = { ...this.extras, [id]: slot };
  }

  clearExtra(id: string) {
    const next = { ...this.extras };
    delete next[id];
    this.extras = next;
  }

  async removeFont(id: string) {
    await deleteFont(id);
    this.fonts = this.fonts.filter((f) => f.id !== id);
    if (this.selectedFontId === id) this.selectedFontId = this.fonts[0]?.id ?? null;
  }

  reset() {
    this.source = null;
    this.clips = [];
    this.extras = {};
    this.notice = null;
  }

  async run() {
    if (this.running) return;
    let plan;
    try {
      plan = this.#buildPlan();
    } catch (err) {
      this.notice = err instanceof Error ? err.message : String(err);
      return;
    }

    const job: VideoJob = {
      id: uid("job"),
      tool: this.toolId,
      toolTitle: this.tool.title,
      sourceName: this.tool.multiClip
        ? `${this.clips.length} clips`
        : this.source?.file.name ?? "unknown",
      status: "running",
      progress: 0,
      stepLabel: "Starting the engine…",
      createdAt: Date.now(),
      elapsedMs: 0,
      inputBytes: this.inputSlots.reduce((sum, slot) => sum + slot.file.size, 0),
      outputBytes: 0,
      artifacts: [],
      error: null,
      log: [],
    };
    this.jobs = [job, ...this.jobs];
    this.running = true;
    const startedAt = performance.now();

    const update = (patch: Partial<VideoJob>) => {
      this.jobs = this.jobs.map((j) => (j.id === job.id ? { ...j, ...patch } : j));
    };

    try {
      await this.ensureEngine();
      if (this.engineState !== "ready") throw new Error(this.engineError ?? "The engine failed to start.");
      await this.#ensureInputsWritten();

      const logTail: string[] = [];
      const result = await videoRuntime.execPlan(plan, {
        expectedDuration: this.#expectedDuration(),
        onProgress: (fraction, stepLabel) => {
          // ffmpeg can emit status lines many times a second; repainting the
          // whole job list that often is pure waste.
          const now = performance.now();
          const done = fraction >= 1;
          if (!done && now - this.#lastProgressAt < 100) return;
          this.#lastProgressAt = now;
          update({
            progress: Math.max(0, Math.min(1, fraction)),
            stepLabel,
            elapsedMs: now - startedAt,
          });
        },
        onLog: (line) => {
          logTail.push(line);
          if (logTail.length > 400) logTail.shift();
        },
      });

      const artifacts = this.#toArtifacts(result.artifacts);
      update({
        status: "done",
        progress: 1,
        stepLabel: "Finished",
        elapsedMs: performance.now() - startedAt,
        outputBytes: artifacts.reduce((sum, a) => sum + a.bytes, 0),
        artifacts,
        log: logTail,
      });
      await videoRuntime.cleanup(
        plan.outputs.flatMap((o) => (o.kind === "file" ? [o.path] : [])),
        plan.outputs.flatMap((o) => (o.kind === "sequence" ? [o.dir] : [])),
      );
    } catch (err) {
      const cancelled = err instanceof JobCancelledError;
      update({
        status: cancelled ? "cancelled" : "error",
        stepLabel: cancelled ? "Cancelled" : "Failed",
        elapsedMs: performance.now() - startedAt,
        error: cancelled ? null : err instanceof Error ? err.message : String(err),
      });
      if (cancelled) this.engineState = "idle";
    } finally {
      this.running = false;
    }
  }

  cancel() {
    if (!this.running) return;
    videoRuntime.cancel();
  }

  download(artifact: JobArtifact) {
    const a = document.createElement("a");
    a.href = artifact.url;
    a.download = artifact.name;
    a.click();
  }

  /** Frame sequences come back as one zip rather than dozens of downloads. */
  async downloadAll(job: VideoJob) {
    if (job.artifacts.length === 1) {
      this.download(job.artifacts[0]!);
      return;
    }
    const entries = await Promise.all(
      job.artifacts.map(async (artifact) => ({
        name: artifact.name,
        data: new Uint8Array(await (await fetch(artifact.url)).arrayBuffer()),
      })),
    );
    const zip = createZip(entries);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem(job.sourceName)}_frames.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  removeJob(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    for (const artifact of job?.artifacts ?? []) URL.revokeObjectURL(artifact.url);
    this.jobs = this.jobs.filter((j) => j.id !== id);
  }

  clearJobs() {
    for (const job of this.jobs) {
      for (const artifact of job.artifacts) URL.revokeObjectURL(artifact.url);
    }
    this.jobs = [];
  }

  /* ------------------------------------------------------------ internals */

  #buildPlan() {
    const font = this.selectedFont;
    const ctx: BuildContext = {
      tool: this.toolId,
      values: this.values,
      source: this.source
        ? { path: this.source.path, info: this.source.info }
        : { path: "src", info: null },
      extras: Object.fromEntries(
        Object.entries(this.extras).map(([id, slot]) => [id, { path: slot.path, info: slot.info }]),
      ),
      clips: this.clips.map((slot) => ({ path: slot.path, info: slot.info })),
      fontDir: font ? FONT_DIR : null,
      fontName: font?.fileName ?? null,
      fontFamily: font?.id ?? null,
    };
    return buildCommand(ctx);
  }

  /**
   * Roughly how many seconds of output ffmpeg will report, so the log's `time=`
   * can be turned into a percentage.
   */
  #expectedDuration(): number {
    const values = this.values;
    const info = this.info;
    const total = info?.durationSec ?? 0;

    switch (this.toolId) {
      case "merge":
        return this.clips.reduce((sum, clip) => sum + (clip.info?.durationSec ?? 0), 0);
      case "speed":
        return total / Math.max(0.05, Number(values.rate) || 1);
      case "loop":
        if (values.mode === "repeat") return total * Math.max(2, Number(values.times) || 2);
        if (values.mode === "boomerang") return total * 2;
        return total;
      case "trim":
      case "gif":
      case "frames": {
        const end = Number(values.end) > 0 ? Number(values.end) : total;
        return Math.max(0, Math.min(end, total || end) - Number(values.start ?? 0));
      }
      case "thumbnail":
        return 0;
      default:
        if (values.trimRange === true) {
          const end = Number(values.end) > 0 ? Number(values.end) : total;
          return Math.max(0, Math.min(end, total || end) - Number(values.start ?? 0));
        }
        return total;
    }
  }

  /** Writes any input whose data predates the current runtime generation. */
  async #ensureInputsWritten() {
    const generation = videoRuntime.generation;
    for (const slot of this.inputSlots) {
      if (slot.writtenAt === generation) continue;
      await videoRuntime.writeFile(slot.path, new Uint8Array(await slot.file.arrayBuffer()));
      slot.writtenAt = generation;
    }
    const font = this.selectedFont;
    if (font) {
      // libass is pointed at this directory via `fontsdir`, and writing into a
      // directory the virtual filesystem does not have yet fails outright.
      await videoRuntime.ensureDir(FONT_DIR);
      await videoRuntime.writeFile(`${FONT_DIR}/${font.fileName}`, new Uint8Array(font.data));
    }
  }

  /** Adopts a file, reporting any failure inline instead of rejecting. */
  async #tryAdopt(file: File, key: string, probe = true): Promise<SourceSlot | null> {
    try {
      return await this.#adopt(file, key, probe);
    } catch (err) {
      this.notice = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  async #adopt(file: File, key: string, probe = true): Promise<SourceSlot> {
    await this.ensureEngine();
    if (this.engineState !== "ready") {
      throw new Error(this.engineError ?? "The engine failed to start.");
    }
    const path = `${key}.${safeExt(file, "bin")}`;
    const data = new Uint8Array(await file.arrayBuffer());

    this.probing = true;
    try {
      let info: MediaInfo | null = null;
      if (probe) {
        info = await videoRuntime.probe(path, data, file.name);
      } else {
        await videoRuntime.writeFile(path, data);
      }
      return { file, path, info, writtenAt: videoRuntime.generation };
    } finally {
      this.probing = false;
    }
  }

  async #addFont(file: File) {
    const data = await file.arrayBuffer();
    let family: string;
    try {
      family = readFontFamily(data);
    } catch (err) {
      this.notice =
        err instanceof UnsupportedFontError ? err.message : "That font file could not be read.";
      return;
    }
    const record: FontRecord = {
      id: family,
      fileName: `${family.replace(/[^\w.-]+/g, "_")}.${safeExt(file, "ttf")}`,
      data,
      addedAt: Date.now(),
    };
    await saveFont(record);
    this.fonts = [record, ...this.fonts.filter((f) => f.id !== family)];
    this.selectedFontId = family;
  }

  #toArtifacts(raw: { name: string; mime: string; blob: Blob }[]): JobArtifact[] {
    return raw.map((item) => ({
      name: item.name,
      mime: item.mime,
      bytes: item.blob.size,
      url: URL.createObjectURL(item.blob),
    }));
  }
}

export const videoStore = new VideoStore();
