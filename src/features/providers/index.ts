import { providerRegistry } from "./provider-registry";
import { voxcpm2Provider } from "./providers/voxcpm2/voxcpm2.provider";

let bootstrapped = false;

/** Register built-in providers once. Adding a provider = implement + register here. */
export function bootstrapProviders() {
  if (bootstrapped) return;
  providerRegistry.register(voxcpm2Provider);
  bootstrapped = true;
}

export { providerRegistry } from "./provider-registry";
export { providerModelManager } from "./provider-model-manager";
export { detectAllProviderCapabilities } from "./provider-capability.service";
