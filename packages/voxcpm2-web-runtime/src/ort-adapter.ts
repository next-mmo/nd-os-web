/**
 * ONNX Runtime Web adapter for VoxCPM2.
 *
 * Consumes two ONNX artifacts (BaseLM + Acoustic/AudioVAE V2) stored in OPFS
 * and exposes the {@link VoxCPM2EngineAdapter} shape that the runtime drives.
 *
 * Execution provider selection is WebGPU-first with a WASM (jsep) fallback:
 * ORT Web's backend resolver handles this for us — we just list
 * `["webgpu", "wasm"]` and the first backend that initialises wins.
 *
 * NOTE on graph contract: the exact input/output tensor names and shapes are
 * determined by the PyTorch → ONNX export (see README "Model export" runbook).
 * The names below match the reference exporter's graph. If the export changes,
 * update `BASELM_IO` / `ACOUSTIC_IO` here — nothing else in the app depends on
 * them.
 */

import type { VoxCPM2GenerateRequest } from "./index";

// `onnxruntime-web` is imported lazily so that environments without the
// package (tests, interim-only builds) can still load this module. The runtime
// only invokes the adapter when real ONNX artifacts are present, so a missing
// import surfaces as a clean "engine unavailable" rather than a boot-time crash.
type OrtModule = typeof import("onnxruntime-web");

// Cached dynamic import — paid once per page load.
let ortPromise: Promise<OrtModule> | null = null;
async function ort(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import("onnxruntime-web").catch((err) => {
      ortPromise = null;
      throw new Error(
        "onnxruntime-web is not installed. Run `pnpm add onnxruntime-web` to enable the ONNX engine.",
        { cause: err },
      );
    });
  }
  return ortPromise;
}

/**
 * Subgraph I/O contract for VoxCPM2 ONNX export.
 *
 * VoxCPM2 is NOT a single forward pass — it's an autoregressive loop over
 * audio patches, each refined by a Conditional Flow Matching (CFM) Euler loop.
 * The reference Python code runs both loops in Python; tracing them into ONNX
 * would fail (data-dependent `.item()` exit, in-place KV-cache writes). So the
 * export decomposes the model into 5 subgraphs and this adapter runs the AR
 * and CFM loops in JS, calling the subgraphs repeatedly.
 *
 * Graph decomposition (matches `scripts/export_voxcpm2_to_onnx.py`):
 *   G1 PREFILL  — base_lm + residual_lm prefill on the full text+ref sequence,
 *                 returns hidden states + initial KV caches.
 *   G2 LOCENC   — per-patch reference encoder; re-encodes each predicted patch.
 *   G3 AR_STEP  — one base_lm.forward_step + residual_lm.forward_step + FSQ +
 *                 fusion projections + stop_head. KV cache passed in AND out.
 *   G4 LOCEDIT  — single LocDiT CFM estimator step (CFG-doubled batch inside).
 *   G5 DECODE   — AudioVAE V2 latent → 48 kHz mono PCM.
 *
 * The AR loop (calls G2→G4→G3 per patch until stop_head fires) and the CFM
 * Euler loop (calls G4 `timesteps` times per patch) live here, in JS.
 *
 * `temperature` is a no-op on the reference path (hardcoded 1.0 in
 * UnifiedCFM); we accept it for API symmetry but do not forward it.
 *
 * Sample rate is 48 kHz — confirmed from config.json `out_sample_rate: 48000`.
 * No resampling is performed unless the runtime requests a different rate.
 */
const GRAPH_IO = {
  // G1: prefill. Inputs: token ids [B,T] int32, text_mask [B,T] bool,
  // feat [B,T,P,D] float32, feat_mask [B,T] bool. Outputs: dit_hidden_prefill
  // [B,1,D], kv_cache_base [num_layers,B,nkv,T,d], kv_cache_res [...].
  prefill: {
    inputs: { tokens: "tokens", textMask: "text_mask", feat: "feat", featMask: "feat_mask" },
    outputs: { hidden: "dit_hidden", kvBase: "kv_cache_base", kvRes: "kv_cache_res" },
  },
  // G2: LocEnc per-patch. [B,T,P,D] → [B,T,D] (CLS token output).
  locenc: {
    inputs: { feat: "feat" },
    outputs: { embed: "embed" },
  },
  // G3: AR step. KV cache in → hidden + KV cache out + stop_logits.
  arStep: {
    inputs: { embed: "embed", kvBase: "kv_cache_base", kvRes: "kv_cache_res", position: "position" },
    outputs: {
      hidden: "dit_hidden",
      kvBaseOut: "kv_cache_base_out",
      kvResOut: "kv_cache_res_out",
      stopLogits: "stop_logits",
    },
  },
  // G4: LocDiT single CFM step. CFG-doubled batch inside the graph.
  locdit: {
    inputs: { x: "x", mu: "mu", t: "t", cond: "cond", dt: "dt" },
    outputs: { velocity: "velocity" },
  },
  // G5: AudioVAE V2 decode. Latent [B,64,T_lat] → audio [B,1,T_pcm] @ 48 kHz.
  decode: {
    inputs: { latent: "latent" },
    outputs: { audio: "audio" },
  },
} as const;

export interface OrtAdapterOptions {
  /** OPFS filename for the G1+G2+G3 graph (or separate files — see filenames). */
  baselmFilename: string;
  /** OPFS filename for the G4+G5 graph (Acoustic / AudioVAE V2). */
  acousticFilename: string;
  /**
   * Target output sample rate. VoxCPM2 AudioVAE V2 outputs 48000; if the
   * runtime asks for a different rate the adapter resamples. Default 48000.
   */
  sampleRate?: number;
  /** Prefer the WebGPU execution provider; fall back to WASM. */
  preferWebGpu?: boolean;
  /** Max intra-op threads for the WASM backend. Ignored on WebGPU. */
  threads?: number;
  /** Fetch a model's bytes from OPFS by filename. Injected so tests can stub OPFS. */
  readModelBytes: (filename: string) => Promise<ArrayBuffer>;
  /** Optional progress callback covering both session loads + inference. */
  onProgress?: (progress: number, message: string) => void;
  /** Cooperative cancellation flag checked between inference steps. */
  isCancelled?: () => boolean;
}

export interface VoxCPM2EngineAdapter {
  load(): Promise<void>;
  synthesize(request: VoxCPM2GenerateRequest): Promise<Float32Array>;
  unload(): Promise<void>;
  readonly backend: "webgpu" | "wasm";
}

/** Native output sample rate of the VoxCPM2 AudioVAE V2 decoder. */
const NATIVE_SAMPLE_RATE = 48000;

/**
 * Latent channels and per-patch time length for the LocDiT CFM loop.
 * `LATENT_CHANNELS = 64` matches AudioVAE V2's `latent_dim`.
 * `LATENT_PATCH_T` is the LocDiT patch length in latent frames — it's a model
 * constant set by `patch_size` in the reference. The exact value comes from
 * the export (see scripts/export_voxcpm2_to_onnx.py `export_locdit_step`).
 * Until the export lands we use the reference default of 1 (one latent frame
 * per AR step); update this when the export reveals the real patch geometry.
 */
const LATENT_CHANNELS = 64;
const LATENT_PATCH_T = 1;

export async function createOrtAdapter(
  options: OrtAdapterOptions,
): Promise<VoxCPM2EngineAdapter> {
  const resolvedBackend: "webgpu" | "wasm" = await pickBackend(options.preferWebGpu);
  const targetRate = options.sampleRate ?? NATIVE_SAMPLE_RATE;

  // Until the export script produces the 5 subgraphs, the adapter loads what's
  // available and reports a clear error. The split (baselm vs acoustic files)
  // follows the GGUF converter's two-file convention; the 5 subgraphs live
  // inside those two files and are reached by name.
  let baselm: import("onnxruntime-web").InferenceSession | null = null;
  let acoustic: import("onnxruntime-web").InferenceSession | null = null;
  let loaded = false;

  async function createSessions(): Promise<void> {
    const ort = await importOrt();
    configureEnv(ort, options.threads);

    options.onProgress?.(0.1, "Loading BaseLM (prefill + AR step + LocEnc)");
    const baselmBytes = await options.readModelBytes(options.baselmFilename);
    baselm = await ort.InferenceSession.create(baselmBytes, {
      executionProviders: resolvedBackend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
    });

    if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");

    options.onProgress?.(0.4, "Loading Acoustic (LocDiT + AudioVAE V2)");
    const acousticBytes = await options.readModelBytes(options.acousticFilename);
    acoustic = await ort.InferenceSession.create(acousticBytes, {
      executionProviders: resolvedBackend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
    });
  }

  async function synthesize(request: VoxCPM2GenerateRequest): Promise<Float32Array> {
    if (!baselm || !acoustic) throw new Error("Adapter not loaded");
    if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");
    const ort = await importOrt();

    const timesteps = request.timesteps ?? 10;
    const guidance = request.guidance ?? 2.0;
    const maxLen = 2000; // matches reference _inference default

    // ---- G1: prefill --------------------------------------------------------
    // Tokens + feat come from the runtime: tokens are BPE ids (see the JS BPE
    // tokenizer that ships alongside this adapter); feat is the LocEnc-encoded
    // reference audio patches, or a zero placeholder for plain TTS.
    //
    // NOTE: the runtime is responsible for producing token ids and the
    // reference feat tensor before calling the adapter. The prefill graph
    // consumes them as-is and returns the initial KV caches + first hidden.
    options.onProgress?.(0.5, "Prefilling BaseLM");
    // The concrete prefill inputs are constructed by the runtime layer that
    // owns tokenization + reference encoding; this adapter drives the loop.
    // The placeholder below stands in until that runtime wiring lands — see
    // the export script's validation harness for the actual tensor shapes.
    const prefillInputs = (request as VoxCPM2GenerateRequest & {
      prefillInputs?: Record<string, import("onnxruntime-web").Tensor>;
    }).prefillInputs;
    if (!prefillInputs) {
      throw new Error(
        "Adapter synthesize() requires prefill inputs (tokens + feat + masks). " +
          "Construct them in the runtime layer after BPE tokenization + LocEnc of reference audio.",
      );
    }
    const prefillOut = await baselm.run(prefillInputs);
    let kvBase = prefillOut[GRAPH_IO.prefill.outputs.kvBase];
    let kvRes = prefillOut[GRAPH_IO.prefill.outputs.kvRes];
    let hidden = prefillOut[GRAPH_IO.prefill.outputs.hidden];
    if (!kvBase || !kvRes || !hidden) {
      throw new Error("Prefill graph missing expected KV-cache or hidden outputs");
    }

    // ---- AR loop ------------------------------------------------------------
    // Each iteration: predict one audio patch via the CFM Euler loop (G4,
    // `timesteps` calls), re-encode it (G2), advance the LMs one step (G3),
    // and check the stop head. Latents accumulate for the final decode.
    const latentChunks: import("onnxruntime-web").Tensor[] = [];
    // AR position tracks the full sequence length (text + ref + generated so
    // far). Prefill consumed text + ref; we start counting after them.
    const textLen = prefillInputs[GRAPH_IO.prefill.inputs.tokens]?.dims[1] ?? 0;
    const refLen = prefillInputs[GRAPH_IO.prefill.inputs.feat]?.dims[1] ?? 0;
    let position = textLen + refLen;

    for (let i = 0; i < maxLen; i++) {
      if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");
      options.onProgress?.(
        0.5 + 0.4 * (i / maxLen),
        `AR step ${i + 1}/${maxLen}`,
      );

      // G4: CFM Euler loop for this patch. Runs `timesteps` LocDiT calls.
      // Initial noise is one latent patch; the seed makes it deterministic.
      let z = initialNoise(request.seed ?? 42, LATENT_PATCH_T, ort);
      const tSpan = linspace(1, 0, timesteps + 1);
      for (let step = 0; step < timesteps; step++) {
        if (options.isCancelled?.()) throw new DOMException("Generation cancelled", "AbortError");
        const t = tSpan[step]!;
        const dt = tSpan[step + 1]! - t;
        const velocity = await runLocditStep(acoustic, z, hidden!, t, dt, guidance, ort);
        z = add(z, scale(velocity, dt, ort), ort);
      }
      latentChunks.push(z);

      // G2: re-encode the predicted patch for the next AR step.
      const encOut = await baselm.run({
        [GRAPH_IO.locenc.inputs.feat]: z,
      });
      const embed = encOut[GRAPH_IO.locenc.outputs.embed];
      if (!embed) throw new Error("LocEnc graph missing 'embed' output");

      // G3: advance the LMs one step; check stop head.
      const stepOut = await baselm.run({
        [GRAPH_IO.arStep.inputs.embed]: embed,
        [GRAPH_IO.arStep.inputs.kvBase]: kvBase,
        [GRAPH_IO.arStep.inputs.kvRes]: kvRes,
        [GRAPH_IO.arStep.inputs.position]: tensorScalar(position, "int32", ort),
      });
      hidden = stepOut[GRAPH_IO.arStep.outputs.hidden] ?? null;
      kvBase = stepOut[GRAPH_IO.arStep.outputs.kvBaseOut] ?? kvBase;
      kvRes = stepOut[GRAPH_IO.arStep.outputs.kvResOut] ?? kvRes;
      if (!hidden) throw new Error("AR step graph missing 'hidden' output");

      const stopLogits = stepOut[GRAPH_IO.arStep.outputs.stopLogits];
      if (stopLogits && argmax(stopLogits.data as Float32Array) === 1 && i > 1) {
        break; // stop token fired
      }
      position += 1;
    }

    // ---- G5: AudioVAE V2 decode --------------------------------------------
    options.onProgress?.(0.92, "Decoding audio (AudioVAE V2)");
    const latent = concatLatents(latentChunks, ort);
    const decodeOut = await acoustic.run({ [GRAPH_IO.decode.inputs.latent]: latent });
    const audioTensor = decodeOut[GRAPH_IO.decode.outputs.audio];
    if (!audioTensor) throw new Error("Decode graph missing 'audio' output");

    const pcm = audioTensor.data as Float32Array;
    return resampleLinear(pcm, NATIVE_SAMPLE_RATE, targetRate);
  }

  async function unload(): Promise<void> {
    baselm?.release?.();
    acoustic?.release?.();
    baselm = null;
    acoustic = null;
    loaded = false;
  }

  return {
    async load() {
      if (loaded) return;
      await createSessions();
      loaded = true;
    },
    synthesize,
    unload,
    get backend() {
      return resolvedBackend;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pickBackend(preferWebGpu?: boolean): Promise<"webgpu" | "wasm"> {
  if (preferWebGpu !== false && typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      // fall through to wasm
    }
  }
  return "wasm";
}

async function importOrt(): Promise<OrtModule> {
  return ort();
}

function configureEnv(ort: OrtModule, threads?: number): void {
  // Configure WASM backend paths + threads before any session is created.
  // The `.wasm` / `.mjs` assets must be served alongside the app bundle.
  if (typeof document !== "undefined") {
    const base = document.baseURI || "/";
    ort.env.wasm.wasmPaths = new URL("ort/", base).href;
  }
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    ort.env.wasm.numThreads = threads ?? Math.min(4, navigator.hardwareConcurrency);
  }
}

function tensorScalar(
  value: number,
  dtype: "int32" | "float32",
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const data = dtype === "int32" ? Int32Array.of(value) : Float32Array.of(value);
  return new ort.Tensor(dtype, data, []);
}

/** Linear resample — adequate for 48 kHz → other common rates. */
function resampleLinear(
  input: Float32Array,
  inRate: number,
  outRate: number,
): Float32Array {
  if (inRate === outRate) return input;
  const ratio = outRate / inRate;
  const out = new Float32Array(Math.floor(input.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

/** Inclusive linspace, matching torch.linspace semantics. */
function linspace(start: number, end: number, steps: number): number[] {
  if (steps <= 1) return [start];
  const out = new Array<number>(steps);
  const step = (end - start) / (steps - 1);
  for (let i = 0; i < steps; i++) out[i] = start + step * i;
  return out;
}

function argmax(arr: Float32Array): number {
  let best = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! > bestVal) {
      bestVal = arr[i]!;
      best = i;
    }
  }
  return best;
}

/**
 * Initial CFM noise. Shape is one latent patch `[1, LATENT_CHANNELS, patchT]`.
 * Deterministic from the seed so the same request reproduces. The reference
 * uses torch.randn; we approximate with a mulberry32 LCG + Box-Muller.
 */
function initialNoise(
  seed: number,
  patchT: number,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const channels = LATENT_CHANNELS;
  const t = Math.max(1, patchT);
  const data = new Float32Array(channels * t);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    // LCG step for u
    s = (s * 1664525 + 1013904223) >>> 0;
    const u = Math.max(1e-9, s / 0xffffffff);
    // Independent LCG step for the second Box-Muller variable
    s = (s * 22695477 + 1) >>> 0;
    const v = s / 0xffffffff;
    const r = Math.sqrt(-2 * Math.log(u));
    data[i] = r * Math.sin(2 * Math.PI * v);
  }
  return new ort.Tensor("float32", data, [1, channels, t]);
}

/**
 * Run one LocDiT CFM step. The graph evaluates the velocity field at (x, t)
 * for BOTH the conditional and unconditional branches (batch doubling); we
 * combine them here with classifier-free guidance:
 *   velocity = unconditional + guidance * (conditional - unconditional)
 * This matches `unified_cfm.py solve_euler` (minus the CFG-Zero-Star warmup,
 * which is a minor quality refinement we omit on the first cut).
 */
async function runLocditStep(
  acoustic: import("onnxruntime-web").InferenceSession,
  z: import("onnxruntime-web").Tensor,
  hidden: import("onnxruntime-web").Tensor,
  t: number,
  dt: number,
  guidance: number,
  ort: OrtModule,
): Promise<import("onnxruntime-web").Tensor> {
  // CFG batch doubling: [conditional (with mu), unconditional (mu=0)].
  const zDoubled = doubleBatch(z, ort);
  const muDoubled = doubleBatchWithZero(hidden, ort);
  // `cond` in LocDiT V2 is the LocEnc-encoded reference conditioning, NOT z.
  // For plain TTS (no reference) it's a zero tensor of the same shape as the
  // LocEnc output; for clone modes it comes from the reference encoder. The
  // adapter receives it via the request's prefillInputs; until that wiring
  // lands we pass zeros and the model behaves as plain TTS.
  const cond = zerosLike(hidden, ort);
  const condDoubled = doubleBatch(cond, ort);
  const out = await acoustic.run({
    [GRAPH_IO.locdit.inputs.x]: zDoubled,
    [GRAPH_IO.locdit.inputs.mu]: muDoubled,
    [GRAPH_IO.locdit.inputs.t]: tensorScalar(t, "float32", ort),
    [GRAPH_IO.locdit.inputs.cond]: condDoubled,
    [GRAPH_IO.locdit.inputs.dt]: tensorScalar(dt, "float32", ort),
  });
  const velocity = out[GRAPH_IO.locdit.outputs.velocity];
  if (!velocity) throw new Error("LocDiT graph missing 'velocity' output");
  // velocity is [2, C, T]: row 0 = conditional, row 1 = unconditional
  return applyCfg(velocity, guidance, ort);
}

/**
 * Classifier-free guidance combination. The graph returns both branches
 * stacked on the batch dim; we compute vel = unc + g * (cond - unc) and
 * return the single-batch result.
 */
function applyCfg(
  velocity: import("onnxruntime-web").Tensor,
  guidance: number,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const data = velocity.data as Float32Array;
  const half = data.length / 2;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const cond = data[i]!;
    const unc = data[half + i]!;
    out[i] = unc + guidance * (cond - unc);
  }
  return new ort.Tensor("float32", out, [1, ...velocity.dims.slice(1)]);
}

function doubleBatch(
  tensor: import("onnxruntime-web").Tensor,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const data = tensor.data as Float32Array;
  const perBatch = data.length;
  const doubled = new Float32Array(perBatch * 2);
  doubled.set(data, 0);
  doubled.set(data, perBatch);
  return new ort.Tensor("float32", doubled, [2, ...tensor.dims.slice(1)]);
}

/**
 * Double the batch with the second half zeroed — used for the CFG
 * unconditional branch (mu=0). Shape mirrors `tensor` on batch dim 0 = 2.
 */
function doubleBatchWithZero(
  tensor: import("onnxruntime-web").Tensor,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const data = tensor.data as Float32Array;
  const perBatch = data.length;
  const doubled = new Float32Array(perBatch * 2);
  doubled.set(data, 0);
  // second half stays zero
  return new ort.Tensor("float32", doubled, [2, ...tensor.dims.slice(1)]);
}

/** All-zeros tensor with the same shape and dtype as `tensor`. */
function zerosLike(
  tensor: import("onnxruntime-web").Tensor,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const dtype =
    tensor.type === "int32"
      ? "int32"
      : tensor.type === "float16"
        ? "float16"
        : "float32";
  const Ctor =
    dtype === "int32" ? Int32Array : dtype === "float16" ? Uint16Array : Float32Array;
  const data = new Ctor(tensor.data.length);
  return new ort.Tensor(dtype, data, tensor.dims);
}

function add(
  a: import("onnxruntime-web").Tensor,
  b: import("onnxruntime-web").Tensor,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const ad = a.data as Float32Array;
  const bd = b.data as Float32Array;
  const out = new Float32Array(ad.length);
  for (let i = 0; i < ad.length; i++) out[i] = ad[i]! + bd[i]!;
  return new ort.Tensor("float32", out, a.dims);
}

function scale(
  tensor: import("onnxruntime-web").Tensor,
  factor: number,
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  const data = tensor.data as Float32Array;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! * factor;
  return new ort.Tensor("float32", out, tensor.dims);
}

function concatLatents(
  chunks: import("onnxruntime-web").Tensor[],
  ort: OrtModule,
): import("onnxruntime-web").Tensor {
  if (chunks.length === 0) throw new Error("No latent chunks to decode");
  const sample = chunks[0]!;
  const perChunk = sample.data.length;
  const total = perChunk * chunks.length;
  const out = new Float32Array(total);
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i]!.data as Float32Array, i * perChunk);
  }
  // Concat along the time dim (last axis). Sample dims: [1, C, T] → [1, C, T*N].
  const dims = [...sample.dims];
  dims[dims.length - 1] = (sample.dims[sample.dims.length - 1] ?? 0) * chunks.length;
  return new ort.Tensor("float32", out, dims);
}
