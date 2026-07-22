# CrispASR VoxCPM2 WebGPU source overlay

This directory vendors the native sources used to build
`public/crispasr/libwhisper.js` and `public/crispasr/libwhisper.wasm`.
It is intentionally a source overlay rather than a complete copy of CrispASR.

- Upstream: <https://github.com/CrispStrobe/CrispASR.git>
- Pinned upstream commit: `eb780dbaeab676c10959c3b3b096f7547bc8af13`
- Emscripten version used for the current browser build: `6.0.3`
- Runtime target: Emscripten + WebGPU + JSPI

## What is included

The overlay contains every CrispASR C/C++ header and implementation changed for
the current VoxCPM2 browser runtime, their directly used native helper headers,
the JavaScript binding, the WebGPU public header, and the complete
`ggml/src/ggml-webgpu` backend including its WGSL kernels and shader generators.
The non-header GGUF loader implementation used by VoxCPM2 is included as well.

The relevant changes include:

- WebGPU-native VoxCPM2 TSLM/RALM prefill and inference graph handling.
- Batched causal prompt prefill and WebGPU-routed projection/FSQ/stop heads.
- Standard matmul/softmax attention fallback for WebGPU.
- VoxCPM2 runtime controls exposed through the C API and Emscripten bindings.
- JSPI-aware asynchronous bindings and explicit GPU-backend selection.
- The exact WebGPU backend and shader sources used by the build.

`src/CMakeLists.txt` also reflects the current browser build setup, where the
unrelated piano-transcription target is disabled.

## Rebuild

1. Clone CrispASR and check out the pinned commit.
2. Activate an Emscripten SDK environment so `emcmake`, `em++`, and `cmake` are
   available on `PATH`.
3. From this repository, run:

```powershell
./scripts/build-crispasr-webgpu.ps1 -CrispAsrRoot C:\path\to\CrispASR
```

The script verifies the upstream revision, applies this overlay, configures a
Release build with `GGML_WEBGPU=ON`, `GGML_WEBGPU_JSPI=ON`, and OpenMP disabled,
builds `libwhisper`, and copies the resulting `.js` and `.wasm` files into
`public/crispasr`.

Use `-AllowDifferentCommit` only when deliberately porting the overlay to a new
upstream revision. Use `-SkipConfigure` to rebuild an already configured build
directory, or `-SyncOnly` to apply native changes without starting a build.

The build script overwrites the corresponding files in the supplied CrispASR
checkout with this overlay. Keep that checkout in source control or use a clean
working branch when developing native changes.
