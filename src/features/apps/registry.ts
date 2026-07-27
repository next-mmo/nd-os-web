import type { Component } from "svelte";
import type { AppId } from "@/features/desktop/types";
import AboutApp from "./about/AboutApp.svelte";
import CalculatorApp from "./calculator/CalculatorApp.svelte";
import CalendarApp from "./calendar/CalendarApp.svelte";
import EditorApp from "./editor/EditorApp.svelte";
import FilesApp from "./files/FilesApp.svelte";
import NotesApp from "./notes/NotesApp.svelte";
import SettingsApp from "./settings/SettingsApp.svelte";
import TerminalApp from "./terminal/TerminalApp.svelte";
import PokerApp from "./poker/PokerApp.svelte";
import TtsStudioApp from "./tts-studio/TtsStudioApp.svelte";
import VideoToolkitApp from "./video-toolkit/VideoToolkitApp.svelte";

/** Maps each AppId to its root UI component. Add new apps here. */
export const appRegistry: Record<AppId, Component> = {
  files: FilesApp,
  notes: NotesApp,
  settings: SettingsApp,
  about: AboutApp,
  calculator: CalculatorApp,
  terminal: TerminalApp,
  calendar: CalendarApp,
  editor: EditorApp,
  "tts-studio": TtsStudioApp,
  "video-toolkit": VideoToolkitApp,
  poker: PokerApp,
};
