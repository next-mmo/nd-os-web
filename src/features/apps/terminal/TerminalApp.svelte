<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { workspace } from "@/domains/workspace";
  import { resolvePath } from "@/shared/lib/paths";
  import { appCatalog } from "@/features/desktop/catalog";
  import type { AppId } from "@/features/desktop/types";
  import { windowManager } from "@/features/desktop/window-manager.svelte";
  import { connectWorkspace } from "@/features/desktop/workspace-actions";
  import { editorSession } from "@/features/apps/editor/editor-session.svelte";

  let termInput = $state("");
  let termCwd = $state("/");
  let termLines = $state<{ kind: "in" | "out"; text: string }[]>([
    { kind: "out", text: "ND OS Web Terminal v0.1.0" },
    { kind: "out", text: "Type 'help' for available commands." },
  ]);

  function ensureTermWorkspace(out: (text: string) => void): boolean {
    if (workspace.status !== "connected") {
      out("workspace not connected — run 'connect' first");
      return false;
    }
    return true;
  }

  async function runTerminalCommand() {
    const raw = termInput.trim();
    const argv = raw.split(/\s+/);
    const cmd = argv[0]?.toLowerCase() ?? "";
    const out = (text: string) => termLines.push({ kind: "out", text });
    termLines.push({ kind: "in", text: raw });

    const resolve = (arg?: string) => resolvePath(termCwd, arg);

    switch (cmd) {
      case "":
        break;
      case "help":
        out("Available commands:");
        out("  help          Show this help");
        out("  echo <txt>    Print text");
        out("  date          Current date and time");
        out("  whoami        Current user");
        out("  apps          List installed apps");
        out("  open <app>    Open an app");
        out("  clear         Clear the screen");
        out("Workspace (requires connection):");
        out("  pwd           Print working directory");
        out("  ls [path]     List directory contents");
        out("  cat <path>    Print file contents");
        out("  cd <path>     Change directory");
        out("  touch <path>  Create empty file");
        out("  mkdir <path>  Create directory");
        out("  rm <path>     Remove file or directory");
        out("  write <p> <t> Write text to a file");
        out("  edit <path>   Open file in Text Editor");
        out("  connect       Connect the workspace");
        break;
      case "echo":
        out(raw.slice(raw.indexOf(" ") + 1));
        break;
      case "date":
        out(new Date().toString());
        break;
      case "whoami":
        out("guest@nd-os-web");
        break;
      case "apps":
        out(Object.keys(appCatalog).join("  "));
        break;
      case "open": {
        const target = argv[1]?.toLowerCase();
        if (target && appCatalog[target as AppId]) {
          windowManager.open(target as AppId);
          out(`Opening ${target}…`);
        } else {
          out(`open: unknown app '${target ?? ""}'`);
        }
        break;
      }
      case "clear":
        termLines = [];
        break;
      case "connect":
        await connectWorkspace();
        out(
          workspace.status === "connected"
            ? `Connected (${workspace.backend})`
            : "Not connected",
        );
        break;
      case "pwd":
        if (!ensureTermWorkspace(out)) break;
        out(termCwd);
        break;
      case "ls": {
        if (!ensureTermWorkspace(out)) break;
        try {
          const entries = await workspace.list(resolve(argv[1]));
          out(
            entries.length === 0
              ? "(empty)"
              : entries
                  .map((e) => (e.kind === "directory" ? `${e.name}/` : e.name))
                  .join("   "),
          );
        } catch (err) {
          out(`ls: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "cd": {
        if (!ensureTermWorkspace(out)) break;
        const path = resolve(argv[1]);
        try {
          const parent = path.slice(0, path.lastIndexOf("/")) || "/";
          const name = path.slice(path.lastIndexOf("/") + 1);
          if (name) {
            const entries = await workspace.list(parent);
            const entry = entries.find((e) => e.name === name);
            if (!entry) {
              out(`cd: no such directory: ${path}`);
              break;
            }
            if (entry.kind !== "directory") {
              out(`cd: not a directory: ${path}`);
              break;
            }
          }
          termCwd = path;
        } catch (err) {
          out(`cd: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "cat": {
        if (!ensureTermWorkspace(out)) break;
        try {
          const content = await workspace.readFile(resolve(argv[1]));
          content.split("\n").forEach((line) => out(line));
        } catch (err) {
          out(`cat: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "touch": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("touch: missing file operand");
          break;
        }
        try {
          await workspace.createFile(resolve(argv[1]));
        } catch (err) {
          out(`touch: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "mkdir": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("mkdir: missing operand");
          break;
        }
        try {
          await workspace.createDir(resolve(argv[1]));
        } catch (err) {
          out(`mkdir: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "rm": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("rm: missing operand");
          break;
        }
        try {
          await workspace.remove(resolve(argv[1]));
        } catch (err) {
          out(`rm: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "write": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("write: usage: write <path> <text>");
          break;
        }
        const text = raw.slice(raw.indexOf(argv[1]) + argv[1].length).trim();
        try {
          await workspace.writeFile(resolve(argv[1]), text);
          out(`Wrote ${text.length} bytes to ${argv[1]}`);
        } catch (err) {
          out(`write: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "edit": {
        if (!ensureTermWorkspace(out)) break;
        if (!argv[1]) {
          out("edit: missing file operand");
          break;
        }
        await editorSession.open(resolve(argv[1]));
        out(`Opening ${argv[1]}…`);
        break;
      }
      default:
        out(`command not found: ${cmd}`);
    }
    termInput = "";
    termLines = [...termLines];
  }
</script>

<div class="term-app bg-background flex h-full flex-col gap-2 p-3 font-mono text-sm">
  <ScrollArea class="term-output min-h-0 flex-1">
    <div class="flex flex-col gap-0.5 pr-3">
      {#each termLines as line}
        {#if line.kind === "in"}
          <div class="term-line in">
            <span class="term-prompt text-muted-foreground">guest@nd-os-web:{termCwd}$</span>
            {line.text}
          </div>
        {:else}
          <div class="term-line out whitespace-pre-wrap">{line.text}</div>
        {/if}
      {/each}
    </div>
  </ScrollArea>
  <form
    class="term-input-row flex items-center gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      void runTerminalCommand();
    }}
  >
    <span class="term-prompt text-muted-foreground shrink-0">guest@nd-os-web:{termCwd}$</span>
    <Input
      class="term-input border-0 bg-transparent shadow-none focus-visible:ring-0"
      bind:value={termInput}
      autocomplete="off"
      spellcheck="false"
      aria-label="Terminal command"
    />
  </form>
</div>
