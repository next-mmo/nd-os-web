import { describe, expect, it, vi } from "vitest";
import type { VoxCPM2Runtime } from "@nd-os/voxcpm2-web-runtime";
import { createVoxCPM2Provider } from "./index";

function mockRuntime(initialize: VoxCPM2Runtime["initialize"]): VoxCPM2Runtime {
  return {
    initialize,
    generate: vi.fn(),
    generateStream: vi.fn(),
    cancel: vi.fn(),
    unload: vi.fn(),
    getStatus: vi.fn(() => ({
      code: "error",
      backend: "unavailable",
      label: "Runtime error",
    }) as const),
    getMemoryUsage: vi.fn(() => ({})),
  };
}

describe("VoxCPM2 provider initialization", () => {
  it("does not silently downgrade an installed GGUF failure to interim DSP", async () => {
    const failure = new Error("WebGPU worker failed");
    const runtime = mockRuntime(vi.fn().mockRejectedValue(failure));
    const runtimeFactory = vi.fn(async () => runtime);
    const provider = createVoxCPM2Provider({ runtimeFactory });

    await expect(
      provider.initialize({ modelIds: ["voxcpm2-q4_k"], preferWebGpu: true }),
    ).rejects.toThrow("WebGPU worker failed");

    await expect(
      provider.generate({
        jobId: "khmer-test",
        text: "សួស្តី។",
        mode: "text-to-speech",
      }),
    ).rejects.toThrow("WebGPU worker failed");

    expect(runtimeFactory).toHaveBeenCalledTimes(1);
    expect(runtime.initialize).toHaveBeenCalledTimes(1);
    expect(runtime.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ allowInterimEngine: false }),
    );
  });

  it("allows interim DSP only when no neural model is selected", async () => {
    const runtime = mockRuntime(vi.fn().mockResolvedValue(undefined));
    const provider = createVoxCPM2Provider({ runtimeFactory: async () => runtime });

    await provider.initialize({ modelIds: [], preferWebGpu: true });

    expect(runtime.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ allowInterimEngine: true }),
    );
  });
});
