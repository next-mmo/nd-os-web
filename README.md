# ND OS Web

[![Build and deploy ND OS Web](https://github.com/next-mmo/nd-os-web/actions/workflows/pages.yml/badge.svg)](https://github.com/next-mmo/nd-os-web/actions/workflows/pages.yml)

A lightweight browser-only desktop starter inspired by ND OS.

This repository intentionally excludes Tauri, Rust, native plugins, shell access, backend service management, terminal features, agents, and LLM integrations.

## Included

- Desktop shortcuts
- Right-click context menu
- Start menu
- Taskbar with running and active states
- Draggable, minimizable, and maximizable windows
- Basic Files placeholder
- Notes persisted in `localStorage`
- **AI TTS Studio** — local-first text-to-speech (VoxCPM2 Browser provider), projects/voices/history in IndexedDB, models in OPFS
- **Poker** — entertainment Texas Hold'em (solo vs bots, peer-to-peer rooms via PeerJS, local bankroll/stats); see `docs/game-play.md`
- Settings for theme, wallpaper, accent, taskbar alignment, and clock seconds
- Responsive mobile layout
- GitHub Pages preview deployment

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`, then launch **AI TTS Studio** from the desktop or Start menu.

### TTS Studio notes

- Generation works offline via the VoxCPM2 runtime package. Until the Emscripten WASM binary is built into `public/voxcpm2/`, the runtime uses an interim local DSP engine and reports **WASM fallback · interim DSP engine** (never labeled as WebGPU).
- To enable native GGUF inference, see `packages/voxcpm2-web-runtime/README.md`.
- Model downloads require explicit confirmation (multi‑GB GGUF files).

## Validation

```bash
pnpm check
pnpm test
pnpm build
```

## Production preview

The `main` branch is automatically type-checked, built, and deployed with GitHub Actions.

## Suggested next additions

- IndexedDB or cloud file storage
- App registry loaded from JSON
- Window resize handles
- Authentication
- PWA manifest and offline cache
- REST API integration
