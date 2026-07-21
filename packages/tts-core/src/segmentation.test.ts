import { describe, expect, it } from "vitest";
import {
  cleanPastedText,
  countWords,
  splitIntoSegments,
  estimateSpeechDurationSec,
} from "@nd-os/tts-core";
import { audioBufferHasSignal, encodeWavMono, decodeWavMono, mergeSegments } from "@nd-os/audio-engine";
import { validateManifest, VOXCPM2_MANIFEST } from "@nd-os/model-storage";
import { createVoxCPM2Runtime } from "@nd-os/voxcpm2-web-runtime";
import { createVoxCPM2Provider } from "@nd-os/voxcpm2-provider";
import { providerRegistry } from "../../../src/features/providers/provider-registry";

describe("text segmentation", () => {
  it("preserves Khmer text", () => {
    const text = "សួស្តី។ ខ្ញុំស្រលាញ់ភាសាខ្មែរ។";
    const segs = splitIntoSegments(text, 280);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.map((s) => s.text).join(" ")).toContain("សួស្តី");
    expect(countWords(text)).toBeGreaterThan(0);
  });

  it("splits long English without breaking mid-word roughly", () => {
    const text = "Hello world. ".repeat(40);
    const segs = splitIntoSegments(text, 80);
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) {
      expect(seg.text.length).toBeLessThanOrEqual(90);
    }
  });

  it("cleans pasted text", () => {
    expect(cleanPastedText("a  \n\n\nb")).toBe("a\n\nb");
  });

  it("estimates duration", () => {
    expect(estimateSpeechDurationSec("Hello")).toBeGreaterThan(0.3);
  });
});

describe("audio engine", () => {
  it("round-trips WAV and detects signal", () => {
    const samples = new Float32Array(4800);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.2;
    }
    const wav = encodeWavMono(samples, 48000);
    const decoded = decodeWavMono(wav);
    expect(decoded.sampleRate).toBe(48000);
    expect(audioBufferHasSignal(decoded.samples)).toBe(true);
  });

  it("merges segments with pause", () => {
    const a = {
      samples: new Float32Array([0.1, 0.2]),
      sampleRate: 48000,
      channels: 1 as const,
      durationSec: 2 / 48000,
    };
    const b = {
      samples: new Float32Array([0.3, 0.4]),
      sampleRate: 48000,
      channels: 1 as const,
      durationSec: 2 / 48000,
    };
    const merged = mergeSegments([a, b], 0);
    expect(merged.samples.length).toBe(4);
  });
});

describe("provider registry", () => {
  it("registers VoxCPM2", () => {
    const provider = createVoxCPM2Provider();
    providerRegistry.register(provider);
    expect(providerRegistry.get("voxcpm2")?.metadata.name).toBe("VoxCPM2 Browser");
  });
});

describe("model manifest", () => {
  it("validates VoxCPM2 manifest", () => {
    const result = validateManifest(VOXCPM2_MANIFEST);
    expect(result.ok).toBe(true);
  });
});

describe("voxcpm2 runtime smoke", () => {
  it("generates real non-silent audio", async () => {
    const runtime = createVoxCPM2Runtime();
    await runtime.initialize({ allowInterimEngine: true });
    const result = await runtime.generate({
      jobId: "test-1",
      text: "Hello from VoxCPM2 studio smoke test.",
      seed: 7,
    });
    expect(result.audio.sampleRate).toBe(48000);
    expect(result.audio.durationSec).toBeGreaterThan(0.3);
    expect(audioBufferHasSignal(result.audio.samples)).toBe(true);
    expect(result.wavBytes.byteLength).toBeGreaterThan(44);
    // Not a bundled fixture — duration scales with text
    const short = await runtime.generate({
      jobId: "test-2",
      text: "Hi",
      seed: 7,
    });
    expect(result.audio.durationSec).toBeGreaterThan(short.audio.durationSec);
  }, 30_000);
});
