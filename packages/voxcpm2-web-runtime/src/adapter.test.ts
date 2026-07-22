import { describe, expect, it } from "vitest";
import {
  createVoxCPM2Runtime,
  createMockAdapter,
  type VoxCPM2GenerateRequest,
} from "@nd-os/voxcpm2-web-runtime";
import { audioBufferHasSignal } from "@nd-os/audio-engine";
import {
  resolveModelFile,
  VOXCPM2_MANIFEST,
  modelFilename,
} from "@nd-os/model-storage";
import { createVoxCPM2Provider } from "@nd-os/voxcpm2-provider";

/**
 * These tests pin down the core guarantee this milestone introduces:
 * the FULL generation request (seed, mode, guidance, timesteps, temperature,
 * reference audio, transcripts) reaches the engine adapter. Previously the
 * WASM call site dropped everything except `text`.
 */

describe("runtime → adapter request forwarding", () => {
  it("forwards seed, guidance, timesteps, temperature and mode to the adapter", async () => {
    const adapter = createMockAdapter({ sampleRate: 48000 });
    const runtime = createVoxCPM2Runtime({ adapter });
    await runtime.initialize({ allowInterimEngine: false });

    const request: VoxCPM2GenerateRequest = {
      jobId: "job-1",
      text: "Hello world.",
      mode: "voice-design",
      voiceDescription: "warm female narrator",
      seed: 99,
      guidance: 3.5,
      timesteps: 25,
      temperature: 0.8,
    };
    await runtime.generate(request);

    expect(adapter.calls).toHaveLength(1);
    const call = adapter.calls[0]!;
    expect(call.text).toBe("Hello world.");
    expect(call.mode).toBe("voice-design");
    expect(call.voiceDescription).toBe("warm female narrator");
    expect(call.seed).toBe(99);
    expect(call.guidance).toBe(3.5);
    expect(call.timesteps).toBe(25);
    expect(call.temperature).toBe(0.8);
  });

  it("produces non-silent PCM whose duration scales with timesteps", async () => {
    const adapter = createMockAdapter({ sampleRate: 48000 });
    const runtime = createVoxCPM2Runtime({ adapter });
    await runtime.initialize({ allowInterimEngine: false });

    const base = await runtime.generate({
      jobId: "a",
      text: "Testing duration scaling.",
      seed: 7,
      timesteps: 10,
    });
    const more = await runtime.generate({
      jobId: "b",
      text: "Testing duration scaling.",
      seed: 7,
      timesteps: 20,
    });

    expect(audioBufferHasSignal(base.audio.samples)).toBe(true);
    expect(audioBufferHasSignal(more.audio.samples)).toBe(true);
    expect(more.audio.durationSec).toBeGreaterThan(base.audio.durationSec);
  });

  it("reports backend honestly from the adapter (not from request shape)", async () => {
    const adapter = createMockAdapter({ sampleRate: 48000 });
    const runtime = createVoxCPM2Runtime({ adapter });
    await runtime.initialize({ allowInterimEngine: false });
    // Mock adapter always reports "wasm"
    expect(runtime.getStatus().backend).toBe("wasm");

    const result = await runtime.generate({ jobId: "x", text: "hi", seed: 1 });
    expect(result.backend).toBe("wasm");
    expect(result.metadata?.engine).toBe("voxcpm2-onnx-wasm");
  });
});

describe("interim-DSP honesty", () => {
  it("reports browser-speech backend (not wasm) when no adapter is wired", async () => {
    const runtime = createVoxCPM2Runtime(); // no adapter
    await runtime.initialize({ allowInterimEngine: true });
    expect(runtime.getStatus().backend).toBe("browser-speech");
    expect(runtime.getStatus().label).toContain("not neural");

    const result = await runtime.generate({ jobId: "y", text: "hello", seed: 1 });
    expect(result.backend).toBe("browser-speech");
    expect(result.metadata?.engine).toBe("interim-dsp");
  });
});

describe("cancellation", () => {
  it("surfaces cancellation from the adapter through AbortError", async () => {
    let cancelFlag = false;
    const adapter = createMockAdapter({
      sampleRate: 48000,
      isCancelled: () => cancelFlag,
    });
    const runtime = createVoxCPM2Runtime({ adapter });
    await runtime.initialize({ allowInterimEngine: false });

    const promise = runtime.generate({
      jobId: "c",
      text: "x".repeat(2000),
      seed: 1,
      timesteps: 50,
    });
    cancelFlag = true;
    await expect(promise).rejects.toThrow(/cancelled/);
  });
});

describe("manifest format field", () => {
  it("declares CrispASR-backed GGUF as the primary required format", () => {
    // CrispASR ships single all-in-one GGUFs (not the old split pair). The
    // Q4_K is the recommended default — required + available.
    const required = VOXCPM2_MANIFEST.models.filter((m) => m.required);
    expect(required.length).toBeGreaterThanOrEqual(1);
    expect(required.every((m) => (m.format ?? "gguf") === "gguf")).toBe(true);
    expect(required.every((m) => m.availability === "available")).toBe(true);
  });

  it("all manifest entries point at real published artifacts", () => {
    // Pins the fix for the e2e download-failure bug: no placeholder URLs,
    // no pending availability. Every model must resolve to a live HF file.
    for (const m of VOXCPM2_MANIFEST.models) {
      expect(m.availability).toBe("available");
      expect(m.downloadUrl).toContain("huggingface.co/cstr/voxcpm2-GGUF");
    }
  });

  it("resolves model id → on-disk filename with the right extension", () => {
    const q4 = resolveModelFile(VOXCPM2_MANIFEST, "voxcpm2-q4_k");
    expect(q4?.filename).toBe("voxcpm2-q4_k.gguf");
    expect(q4?.format).toBe("gguf");
    expect(q4?.opfsPath).toBe("models/voxcpm2-q4_k.gguf");

    const byFilename = VOXCPM2_MANIFEST.models.find((m) => m.id === "voxcpm2-q8_0")!;
    expect(modelFilename(byFilename)).toBe("voxcpm2-q8_0.gguf");
  });

  it("returns null for unknown model ids", () => {
    expect(resolveModelFile(VOXCPM2_MANIFEST, "does-not-exist")).toBeNull();
  });
});

/**
 * Provider-level status propagation. Pins the guarantee that the store can
 * trust provider.getStatus() to reflect what the runtime actually loaded,
 * not a hardcoded label. This was a real bug: the store used to overwrite
 * the runtime's honest status with a stale "wasm fallback" string.
 */
describe("provider status propagation", () => {
  it("returns null before initialize()", () => {
    const provider = createVoxCPM2Provider();
    expect(provider.getStatus?.()).toBeNull();
  });

  it("reflects the runtime's honest status after initialize()", async () => {
    const provider = createVoxCPM2Provider();
    await provider.initialize({
      // No models installed → runtime runs interim-DSP and reports it honestly.
      modelIds: [],
      preferWebGpu: false,
    });
    const status = provider.getStatus?.();
    expect(status).not.toBeNull();
    // Interim DSP must NOT claim webgpu or wasm neural — that was the whole
    // point of the honesty fix.
    expect(status!.backend).toBe("browser-speech");
    expect(status!.label).toMatch(/not neural/i);
  });
});

/**
 * Guidance must actually affect output. Before the CFG-math fix, guidance was
 * silently dropped (the adapter returned the raw conditional velocity without
 * combining it with the unconditional branch). The mock adapter doesn't
 * implement real CFG, but we can verify the runtime forwards guidance to the
 * adapter call record — proving the value isn't lost on the way.
 */
describe("guidance forwarding", () => {
  it("different guidance values reach the adapter", async () => {
    const adapter = createMockAdapter({ sampleRate: 48000 });
    const runtime = createVoxCPM2Runtime({ adapter });
    await runtime.initialize({ allowInterimEngine: false });

    await runtime.generate({ jobId: "lo", text: "test", seed: 1, guidance: 1.0 });
    await runtime.generate({ jobId: "hi", text: "test", seed: 1, guidance: 5.0 });

    expect(adapter.calls[0]!.guidance).toBe(1.0);
    expect(adapter.calls[1]!.guidance).toBe(5.0);
    expect(adapter.calls[0]!.guidance).not.toBe(adapter.calls[1]!.guidance);
  });
});
