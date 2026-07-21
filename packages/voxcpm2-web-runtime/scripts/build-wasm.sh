#!/usr/bin/env bash
# Scaffold for Emscripten build of VoxCPM2 browser runtime.
# Does not download multi-GB models. Point VOXCPM_CPP at a local checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
OUT="$REPO_ROOT/public/voxcpm2"
VOXCPM_CPP="${VOXCPM_CPP:-}"

if [[ -z "$VOXCPM_CPP" || ! -d "$VOXCPM_CPP" ]]; then
  echo "Set VOXCPM_CPP to a VoxCPM.cpp (or llama.cpp-omni) checkout."
  echo "See packages/voxcpm2-web-runtime/README.md"
  exit 1
fi

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found. Activate emsdk first."
  exit 1
fi

mkdir -p "$OUT"
echo "Building WASM into $OUT …"
# Delegate to upstream wasm build when available.
if [[ -f "$VOXCPM_CPP/scripts/build_wasm.sh" ]]; then
  (cd "$VOXCPM_CPP" && bash scripts/build_wasm.sh)
  echo "Copy generated artifacts into $OUT manually if upstream uses a different out dir."
else
  echo "No scripts/build_wasm.sh in VOXCPM_CPP — wire your emcmake target here."
  exit 1
fi
