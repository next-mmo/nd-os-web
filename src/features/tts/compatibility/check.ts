import type { CompatibilityReport } from "@nd-os/shared-types";
import { opfsAvailable, estimateStorage } from "@nd-os/model-storage";

function detectWasmSimd(): boolean {
  try {
    // Minimal WASM module using SIMD opcode (i8x16.splat)
    const bytes = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
      8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

export async function runCompatibilityCheck(): Promise<CompatibilityReport> {
  const details: string[] = [];
  let webgpu = false;
  let webgpuAdapter: string | undefined;
  let shaderF16: boolean | undefined;

  try {
    if ("gpu" in navigator) {
      const adapter = await (
        navigator as Navigator & { gpu: GPU }
      ).gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        webgpuAdapter = adapter.info?.device || adapter.info?.description || "GPU adapter";
        const features = adapter.features;
        shaderF16 = features?.has?.("shader-f16") ?? false;
        details.push(`WebGPU adapter: ${webgpuAdapter}`);
      } else {
        details.push("WebGPU: no adapter");
      }
    } else {
      details.push("WebGPU: not supported");
    }
  } catch (err) {
    details.push(`WebGPU error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const wasmSimd = detectWasmSimd();
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const crossOriginIsolated = Boolean(globalThis.crossOriginIsolated);
  const workers = typeof Worker !== "undefined";
  const opfs = await opfsAvailable();
  const storage = await estimateStorage();
  const deviceMemoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  details.push(`WASM SIMD: ${wasmSimd ? "yes" : "no"}`);
  details.push(`SharedArrayBuffer: ${sharedArrayBuffer ? "yes" : "no"}`);
  details.push(`Cross-origin isolated: ${crossOriginIsolated ? "yes" : "no"}`);
  details.push(`Workers: ${workers ? "yes" : "no"}`);
  details.push(`OPFS: ${opfs ? "yes" : "no"}`);
  if (storage.quota) details.push(`Storage quota ≈ ${Math.round(storage.quota / 1e9)} GB`);
  if (deviceMemoryGb) details.push(`deviceMemory: ${deviceMemoryGb} GB`);

  let tier: CompatibilityReport["tier"] = "unsupported";
  if (!workers || typeof WebAssembly === "undefined") {
    tier = "unsupported";
  } else if (webgpu && wasmSimd && (sharedArrayBuffer || crossOriginIsolated)) {
    tier = "recommended";
  } else if (wasmSimd) {
    tier = deviceMemoryGb !== undefined && deviceMemoryGb < 4 ? "limited" : "compatible";
  } else if (typeof WebAssembly !== "undefined") {
    tier = "limited";
  }

  return {
    tier,
    webgpu,
    webgpuAdapter,
    shaderF16,
    wasmSimd,
    sharedArrayBuffer,
    crossOriginIsolated,
    workers,
    opfs,
    storageEstimateBytes: storage.quota,
    deviceMemoryGb,
    browser: navigator.userAgent,
    platform: navigator.platform,
    details,
  };
}

export function tierLabel(tier: CompatibilityReport["tier"]): string {
  switch (tier) {
    case "recommended":
      return "Recommended — WebGPU and WASM threads available";
    case "compatible":
      return "Compatible — WASM mode available; generation may be slow";
    case "limited":
      return "Limited — The model may not fit in available memory";
    case "unsupported":
      return "Unsupported — Required browser features are unavailable";
    default:
      return "Unknown compatibility tier";
  }
}
