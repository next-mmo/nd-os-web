import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@nd-os/shared-types": path.resolve(root, "packages/shared-types/src/index.ts"),
      "@nd-os/tts-core": path.resolve(root, "packages/tts-core/src/index.ts"),
      "@nd-os/audio-engine": path.resolve(root, "packages/audio-engine/src/index.ts"),
      "@nd-os/model-storage": path.resolve(root, "packages/model-storage/src/index.ts"),
      "@nd-os/voxcpm2-web-runtime": path.resolve(
        root,
        "packages/voxcpm2-web-runtime/src/index.ts",
      ),
      "@nd-os/voxcpm2-provider": path.resolve(
        root,
        "packages/voxcpm2-provider/src/index.ts",
      ),
    },
  },
});
