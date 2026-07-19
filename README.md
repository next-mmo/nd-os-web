# ND OS Web

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
- Settings for theme, wallpaper, accent, taskbar alignment, and clock seconds
- Responsive mobile layout
- GitHub Pages preview deployment

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

## Validation

```bash
pnpm check
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
