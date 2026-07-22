# VoxCPM2 Web Runtime

TypeScript browser runtime for VoxCPM2. Selects between three engine tiers at
boot and reports the active one honestly in `RuntimeStatus`.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ VoxCPM2GenerateRequest (text, mode, seed, guidance,         │
│   timesteps, temperature, referencePcm, transcripts)        │
└───────────────────────────┬─────────────────────────────────┘
                            │
              createVoxCPM2Runtime({ adapter })
                            │
        ┌───────────────────┼──────────────────────┐
        ▼                   ▼                      ▼
   ONNX adapter       (no adapter)            (future)
   ort-adapter.ts     → interim DSP           gguf adapter
   WebGPU / WASM      browser-speech          llama.cpp-omni WASM
```

### Engine tiers

| Tier | When | `backend` | Status label |
|---|---|---|---|
| **ONNX Runtime Web** (primary) | Both required ONNX models installed in OPFS | `webgpu` or `wasm` | `VoxCPM2 ready · ONNX WebGPU` / `· ONNX WASM` |
| **Interim DSP** (fallback) | ONNX models absent | `browser-speech` | `Interim DSP (not neural)` |
| GGUF / WASM (future) | Not yet wired — see Milestone 3 | — | — |

The interim path is **never** reported as `wasm` or `webgpu`. It exists so the
studio vertical slice works offline; it sounds like a buzzer, not speech.

## Milestones

### Milestone 1 — done ✅

Adapter contract, honest status reporting, full-request forwarding, manifest
format field, mock adapter, tests. The studio boots, the runtime accepts any
`VoxCPM2EngineAdapter`, and every field of the request reaches the engine.

### Milestone 2 — ONNX artifacts (blocking neural audio)

The JS layer is ready. What's missing is the ONNX binary itself.

**Corrected facts from the reference probe** (these supersede earlier notes):

- **Sample rate is 48 kHz**, not 24 kHz. `config.json` declares
  `audio_vae_config.out_sample_rate: 48000`. The adapter ships with
  `NATIVE_SAMPLE_RATE = 48000`.
- **Text uses a BPE tokenizer** (`LlamaTokenizerFast`, vocab ~73,448), not
  byte-level tokenization. "Tokenizer-free" refers only to the *audio* side.
  Ship `tokenizer.json` (3.5 MB) and run BPE in JS (the `tokenizers` WASM
  build loads it directly).
- **VoxCPM2 is not a single forward pass.** It's an autoregressive loop over
  audio patches, each refined by a 10-step Conditional Flow Matching Euler
  loop. The Python reference runs both loops with data-dependent `.item()`
  exits and in-place KV-cache writes — neither traces into ONNX.
- **No custom CUDA / Triton kernels.** The reference is clean PyTorch:
  standard SDPA attention, plain convs, RMSNorm, RoPE. The export hazards are
  structural (loops + KV cache), not op-level.

**2a. Export the model.** Run `scripts/export_voxcpm2_to_onnx.py` on a GPU box.
It decomposes the model into 5 subgraphs and leaves the AR + CFM loops to JS:

| Graph | File | Purpose | Export difficulty |
|---|---|---|---|
| G1 prefill | `voxcpm2-baselm-prefill.onnx` | base_lm + residual_lm over full sequence, returns hidden + KV caches | Medium — must materialise KV cache as outputs |
| G2 LocEnc | `voxcpm2-baselm-locenc.onnx` | per-patch reference encoder; re-encodes each predicted patch | Easy |
| G3 AR step | `voxcpm2-baselm-arstep.onnx` | one base_lm.forward_step + residual_lm.forward_step + FSQ + fusion + stop_head | **Hard** — KV cache as tensor I/O via concat (not in-place write) |
| G4 LocDiT | `voxcpm2-acoustic-locdit.onnx` | single CFM estimator step, CFG-doubled batch inside | Easy |
| G5 decode | `voxcpm2-acoustic-decode.onnx` | AudioVAE V2 latent → 48 kHz mono PCM | Easy — merge weight_norm first |

Graph I/O names are pinned in `src/ort-adapter.ts` (`GRAPH_IO`). Update those
constants if the exporter changes names — nothing else in the app depends on
them.

**2b. Host the artifacts.** Upload the validated ONNX files to a HF repo and
update `downloadUrl` + `bytes` in `VOXCPM2_MANIFEST` (`packages/model-storage`).
Drop ORT's `.wasm` / `.mjs` into `public/ort/` (the adapter points
`env.wasm.wasmPaths` there).

### Milestone 3 — GGUF / WASM native (optional, future)

The GGUF manifest entries (`voxcpm2-baselm-q8`, `voxcpm2-acoustic-f16`) are
kept but `required: false`. Wiring them requires a browser-capable WASM binary
from `bluryar/VoxCPM.cpp` or `tc-mb/llama.cpp-omni` — neither ships one as of
writing. A separate `gguf-adapter.ts` would satisfy the same
`VoxCPM2EngineAdapter` contract via Emscripten's C ABI.

## Cross-origin isolation

Required for ORT's threaded WASM backend (pthreads):

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

`vite.config.ts` sets these for `server` and `preview`. Production deploys must
set them at the host level — without them ORT silently falls back to
single-threaded WASM even on capable hardware.

## Tests

`src/adapter.test.ts` pins the core guarantee this milestone introduced:
**every field of `VoxCPM2GenerateRequest` reaches the adapter**, audio is
non-silent and scales with timesteps, and the backend label is reported
honestly. Run with `pnpm vitest`.
