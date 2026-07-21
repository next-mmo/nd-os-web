/// <reference lib="webworker" />
import { computeWaveformPeaks } from "@nd-os/audio-engine";
import type { WaveformWorkerRequest } from "./messages";

self.onmessage = (event: MessageEvent<WaveformWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "peaks") {
    const peaks = computeWaveformPeaks(msg.samples, msg.bars ?? 128);
    self.postMessage({ type: "peaks", peaks });
  }
};
