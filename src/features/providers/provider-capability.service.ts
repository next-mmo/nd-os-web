import type { TTSProvider, TTSProviderCapabilities } from "./provider.types";
import { providerRegistry } from "./provider-registry";

export async function detectAllProviderCapabilities(): Promise<
  Record<string, TTSProviderCapabilities>
> {
  const out: Record<string, TTSProviderCapabilities> = {};
  for (const provider of providerRegistry.list()) {
    out[provider.metadata.id] = await provider.detectCapabilities();
  }
  return out;
}

export function filterProvidersByMode(
  mode: string,
  capabilities: Record<string, TTSProviderCapabilities>,
): TTSProvider[] {
  return providerRegistry.list().filter((p) => {
    const caps = capabilities[p.metadata.id];
    if (!caps?.available) return false;
    return caps.supportedModes.includes(mode as never);
  });
}
