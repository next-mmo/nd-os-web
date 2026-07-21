# VoxCPM2 Web Runtime

TypeScript browser runtime for VoxCPM2 GGUF inference.

## Target path

```text
VoxCPM2 GGUF → llama.cpp-omni / VoxCPM.cpp → Emscripten → WASM SIMD (+ threads)
→ Web Worker → this package → Svelte studio
```

## Build WASM (Milestone 2)

Requires Emscripten SDK and a checkout of [VoxCPM.cpp](https://github.com/bluryar/VoxCPM.cpp) or [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni).

```bash
# Example once emsdk is active:
./scripts/build-wasm.sh
# Outputs to apps public folder: public/voxcpm2/voxcpm2.js + voxcpm2.wasm
```

Until artifacts exist, `createVoxCPM2Runtime()` uses an interim local DSP engine and reports status as **WASM fallback · interim DSP engine**. It never labels that path as WebGPU.

## Cross-origin isolation

WASM threads need:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
