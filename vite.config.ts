import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Required for SharedArrayBuffer / WASM threads when VoxCPM2 WASM is loaded. */
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  base: "./",
  plugins: [tailwindcss(), svelte()],
  optimizeDeps: {
    // ONNX Runtime ships WebAssembly assets that Vite must keep as external
    // files instead of pre-bundling during dependency optimization.
    exclude: ["onnxruntime-web"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      $lib: path.resolve(root, "src/lib"),
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
  worker: {
    // CrispASR's Emscripten loader uses importScripts(), which requires a
    // classic worker. Keep the worker self-contained (no code splitting).
    format: "iife",
  },
  server: {
    host: true,
    port: 5173,
    headers: isolationHeaders,
  },
  preview: {
    host: true,
    port: 4173,
    headers: isolationHeaders,
  },
});
