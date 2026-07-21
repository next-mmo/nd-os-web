/** Centralized localStorage keys used across the shell and apps. */
export const STORAGE_KEYS = {
  settings: "nd-os-web:settings",
  windows: "nd-os-web:windows",
  notes: "nd-os-web:notes",
  editorRecent: "nd-os-web:editor-recent",
  workspaceSeeded: "nd-os-web:workspace-seeded",
  /** Last successful workspace backend — survives reload even if FSA permission drops. */
  workspaceBound: "nd-os-web:workspace-bound",
  /** Free-form desktop icon positions. */
  desktopIcons: "nd-os-web:desktop-icons",
} as const;
