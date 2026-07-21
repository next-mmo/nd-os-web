/// <reference lib="webworker" />
import { createVoxCPM2Runtime } from "@nd-os/voxcpm2-web-runtime";
import type { RuntimeWorkerRequest, RuntimeWorkerResponse } from "./messages";

const runtime = createVoxCPM2Runtime();

function post(msg: RuntimeWorkerResponse, transfer?: Transferable[]) {
  self.postMessage(msg, transfer ?? []);
}

self.onmessage = async (event: MessageEvent<RuntimeWorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init":
        await runtime.initialize({ allowInterimEngine: msg.allowInterimEngine !== false });
        post({ type: "status", label: runtime.getStatus().label });
        break;
      case "generate": {
        const result = await runtime.generateStream(
          { jobId: msg.jobId, text: msg.text, seed: msg.seed },
          {
            onProgress: (progress, message) =>
              post({ type: "status", label: message, progress }),
          },
        );
        post(
          {
            type: "result",
            jobId: msg.jobId,
            wavBytes: result.wavBytes,
            sampleRate: result.audio.sampleRate,
            durationSec: result.audio.durationSec,
          },
          [result.wavBytes],
        );
        break;
      }
      case "cancel":
        await runtime.cancel();
        post({ type: "status", label: "Cancelled" });
        break;
      case "unload":
        await runtime.unload();
        post({ type: "status", label: "Unloaded" });
        break;
    }
  } catch (err) {
    post({
      type: "error",
      jobId: "jobId" in msg ? msg.jobId : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
