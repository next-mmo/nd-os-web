import type { TTSProvider } from "./provider.types";

const providers = new Map<string, TTSProvider>();

export const providerRegistry = {
  register(provider: TTSProvider) {
    providers.set(provider.metadata.id, provider);
  },

  get(id: string): TTSProvider | undefined {
    return providers.get(id);
  },

  list(): TTSProvider[] {
    return [...providers.values()];
  },

  ids(): string[] {
    return [...providers.keys()];
  },
};
