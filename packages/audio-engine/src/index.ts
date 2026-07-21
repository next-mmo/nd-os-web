import type { TTSAudioBuffer } from "@nd-os/shared-types";

/** Encode mono float32 PCM to 16-bit WAV. Default 48 kHz. */
export function encodeWavMono(
  samples: Float32Array,
  sampleRate = 48000,
): ArrayBuffer {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export function decodeWavMono(wav: ArrayBuffer): TTSAudioBuffer {
  const view = new DataView(wav);
  if (readString(view, 0, 4) !== "RIFF" || readString(view, 8, 4) !== "WAVE") {
    throw new Error("Invalid WAV file");
  }

  let offset = 12;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readString(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    offset += 8;
    if (id === "fmt ") {
      sampleRate = view.getUint32(offset + 4, true);
      bitsPerSample = view.getUint16(offset + 14, true);
    } else if (id === "data") {
      dataOffset = offset;
      dataSize = size;
      break;
    }
    offset += size + (size % 2);
  }

  if (dataOffset < 0) throw new Error("WAV missing data chunk");

  const sampleCount = Math.floor(dataSize / (bitsPerSample / 8));
  const samples = new Float32Array(sampleCount);
  if (bitsPerSample === 16) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = view.getInt16(dataOffset + i * 2, true) / 0x8000;
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = view.getFloat32(dataOffset + i * 4, true);
    }
  } else {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  return {
    samples,
    sampleRate,
    channels: 1,
    durationSec: sampleCount / sampleRate,
  };
}

/** Merge segment buffers with configurable silence (seconds) between them. */
export function mergeSegments(
  segments: TTSAudioBuffer[],
  pauseSec = 0.25,
): TTSAudioBuffer {
  if (!segments.length) {
    return { samples: new Float32Array(0), sampleRate: 48000, channels: 1, durationSec: 0 };
  }
  const sampleRate = segments[0]!.sampleRate;
  const pauseSamples = Math.floor(pauseSec * sampleRate);
  let total = 0;
  for (const seg of segments) {
    if (seg.sampleRate !== sampleRate) {
      throw new Error("Cannot merge segments with different sample rates");
    }
    total += seg.samples.length + pauseSamples;
  }
  total -= pauseSamples;

  const out = new Float32Array(total);
  let offset = 0;
  segments.forEach((seg, i) => {
    out.set(seg.samples, offset);
    offset += seg.samples.length;
    if (i < segments.length - 1 && pauseSamples > 0) {
      offset += pauseSamples;
    }
  });

  return {
    samples: out,
    sampleRate,
    channels: 1,
    durationSec: out.length / sampleRate,
  };
}

export function computeWaveformPeaks(samples: Float32Array, bars = 128): number[] {
  if (!samples.length) return Array.from({ length: bars }, () => 0);
  const block = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * block;
    const end = Math.min(samples.length, start + block);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]!);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  return peaks;
}

export function downloadArrayBuffer(filename: string, data: ArrayBuffer, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function audioBufferHasSignal(samples: Float32Array, threshold = 1e-4): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > threshold) return true;
  }
  return false;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function readString(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}
