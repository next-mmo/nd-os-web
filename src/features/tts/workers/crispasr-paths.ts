/**
 * Shared CrispASR asset-path logic for the main thread and the runtime worker.
 *
 * The runtime worker is constructed from a classic `blob:` script (see
 * `createRuntimeWorker` in the provider's runtime-factory), so it cannot
 * resolve `crispasr/…` relative to its own `self.location`. The main thread
 * computes the absolute URLs and bakes them into the bootstrap blob instead.
 */

// Public runtime assets are not fingerprinted by Vite. Bump this whenever the
// native build changes so browsers and deployment CDNs cannot reuse an older,
// numerically incompatible loader/WASM pair.
export const CRISPASR_RUNTIME_VERSION = "2026-07-22-webgpu-native48-2";

export interface CrispASRAssetUrls {
  loader: string;
  wasm: string;
}

/** Resolve the loader/wasm URLs against an absolute base (usually the page). */
export function crispasrAssetUrls(baseHref: string): CrispASRAssetUrls {
  const base = new URL(import.meta.env.BASE_URL || "./", baseHref);
  return {
    loader: `${new URL("crispasr/libwhisper.js", base).href}?v=${CRISPASR_RUNTIME_VERSION}`,
    wasm: `${new URL("crispasr/libwhisper.wasm", base).href}?v=${CRISPASR_RUNTIME_VERSION}`,
  };
}
