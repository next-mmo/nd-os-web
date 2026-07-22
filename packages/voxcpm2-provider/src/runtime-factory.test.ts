import { describe, expect, it } from "vitest";
import { createStudioRuntime } from "./runtime-factory";
import { VOXCPM2_MANIFEST } from "@nd-os/model-storage";

// Stub Worker for testing worker-proxy message flow
class MockWorker extends EventTarget implements Worker {
  postMessage(message: any, _options?: StructuredSerializeOptions | Transferable[]): void {
    const request = message;
    // Simulate worker-side message handling
    setTimeout(() => {
      if (request.type === "init") {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "status", label: "Model ready", backend: "webgpu" },
          }),
        );
      } else if (request.type === "generate") {
        // Echo mock output back
        const sampleRate = 48000;
        const fakePcm = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        this.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "result",
              jobId: request.jobId,
              pcmBytes: fakePcm.buffer.slice(0),
              wavBytes: fakePcm.buffer,
              sampleRate,
              durationSec: fakePcm.length / sampleRate,
            },
          }),
        );
      }
    }, 5);
  }
  terminate(): void {}
  onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  addEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }
  removeEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
  dispatchEvent(event: Event): boolean {
    if (this.onmessage && event.type === "message") {
      this.onmessage.call(this as unknown as Worker, event as MessageEvent);
    }
    return super.dispatchEvent(event);
  }
}

describe("worker proxy runtime", () => {
  it("spawns the worker and loads model on initialize", async () => {
    const requiredId = VOXCPM2_MANIFEST.models.find((m) => m.required)!.id;
    // Tell the factory that the required GGUF model is installed in OPFS
    const runtime = await createStudioRuntime({
      installedModelIds: [requiredId],
      WorkerClass: MockWorker as any,
    });

    expect(runtime.getStatus().code).toBe("idle");
    await runtime.initialize({ baselmPath: requiredId });
    // Since initialize now correctly awaits the worker-side status response,
    // it is "ready" by the time the await resolves!
    expect(runtime.getStatus().code).toBe("ready");
    expect(runtime.getStatus().label).toBe("Model ready");
  });

  it("posts generate request and returns Float32Array PCM on completed", async () => {
    const requiredId = VOXCPM2_MANIFEST.models.find((m) => m.required)!.id;
    const runtime = await createStudioRuntime({
      installedModelIds: [requiredId],
      WorkerClass: MockWorker as any,
    });
    await runtime.initialize({ baselmPath: requiredId });

    const result = await runtime.generate({
      jobId: "task-99",
      text: "Hello from CrispASR worker test",
    });

    expect(result.jobId).toBe("task-99");
    expect(result.audio.sampleRate).toBe(48000);
    expect(result.audio.samples.length).toBe(4);
    expect(result.backend).toBe("webgpu");
  });

  it("accepts an installed optional GGUF quantization", async () => {
    const optionalId = VOXCPM2_MANIFEST.models.find((m) => !m.required)!.id;
    const runtime = await createStudioRuntime({
      installedModelIds: [optionalId],
      WorkerClass: MockWorker as any,
    });

    await runtime.initialize({ baselmPath: optionalId });
    expect(runtime.getStatus().code).toBe("ready");
  });
});
