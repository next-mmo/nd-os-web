/// <reference lib="webworker" />
import { decodeWavMono, encodeWavMono, mergeSegments } from "@nd-os/audio-engine";
import type { AudioWorkerRequest } from "./messages";

self.onmessage = async (event: MessageEvent<AudioWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "encode-wav") {
      const wav = encodeWavMono(msg.samples, msg.sampleRate);
      self.postMessage({ type: "wav", wavBytes: wav }, [wav]);
      return;
    }
    if (msg.type === "merge") {
      const buffers = msg.segments.map((bytes) => decodeWavMono(bytes));
      const merged = mergeSegments(buffers, msg.pauseSec);
      const wav = encodeWavMono(merged.samples, merged.sampleRate);
      self.postMessage({ type: "wav", wavBytes: wav }, [wav]);
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
