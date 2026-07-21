/// <reference lib="webworker" />
import { downloadToOpfs } from "@nd-os/model-storage";
import type { ModelDownloadWorkerRequest } from "./messages";

const controllers = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent<ModelDownloadWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    controllers.get(msg.filename)?.abort();
    return;
  }
  if (msg.type === "download") {
    const controller = new AbortController();
    controllers.set(msg.filename, controller);
    try {
      const result = await downloadToOpfs({
        url: msg.url,
        filename: msg.filename,
        expectedBytes: msg.expectedBytes,
        signal: controller.signal,
        onProgress: (received, total) => {
          self.postMessage({ type: "progress", filename: msg.filename, received, total });
        },
      });
      self.postMessage({ type: "done", ...result });
    } catch (err) {
      self.postMessage({
        type: "error",
        filename: msg.filename,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      controllers.delete(msg.filename);
    }
  }
};
