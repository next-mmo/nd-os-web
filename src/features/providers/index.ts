import { providerRegistry } from "./provider-registry";
import { voxcpm2Provider } from "./providers/voxcpm2/voxcpm2.provider";

let bootstrapped = false;

/**
 * VoxCPM2 neural synthesis requires a cross-origin-isolated context: the
 * shipped `libwhisper.wasm` imports a *shared* memory (`env.memory`,
 * flags=0x3, 2 GiB initial / 4 GiB max), so it cannot instantiate at all
 * without `SharedArrayBuffer`. That is encoded in the binary's import
 * section, not the JS loader — no shim can work around it.
 *
 * Vite sets COOP/COEP for dev and preview, and `vercel.json` sets them for
 * Vercel, so isolation holds on those surfaces (measured: the Electron
 * in-app webview reports `crossOriginIsolated === true`). GitHub Pages
 * cannot send custom headers, so that deploy target is not supported.
 */
function voxcpm2CanLoad(): boolean {
  return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
}

/** Register built-in providers once. Adding a provider = implement + register here. */
export function bootstrapProviders() {
  if (bootstrapped) return;
  // Registering the provider on a non-isolated origin would surface it in the
  // picker and then fail with a LinkError the moment the worker instantiates
  // the wasm. Leaving it unregistered yields the honest "No provider
  // available" empty state instead.
  if (voxcpm2CanLoad()) providerRegistry.register(voxcpm2Provider);
  bootstrapped = true;
}

export { providerRegistry } from "./provider-registry";
export { providerModelManager } from "./provider-model-manager";
export { detectAllProviderCapabilities } from "./provider-capability.service";
