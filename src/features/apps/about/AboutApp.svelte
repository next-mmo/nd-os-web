<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
</script>

<div class="about-app flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
  <div class="about-logo">N</div>
  <Badge variant="secondary">Minimal starter</Badge>
  <h1 class="text-2xl font-semibold tracking-tight">ND OS Web</h1>
  <p class="text-muted-foreground max-w-md text-sm">
    A clean browser-only desktop shell without Tauri, Rust, native plugins, terminal tooling,
    backend services, or LLM features.
  </p>
  <div class="about-features flex flex-wrap justify-center gap-2">
    {#each ["Desktop", "Context menu", "Taskbar", "Windows", "Settings", "Persistence"] as feature}
      <Badge variant="outline">{feature}</Badge>
    {/each}
  </div>
  <Separator class="max-w-xs" />
  <small class="text-muted-foreground">Version 0.1.0 · Svelte + Vite + shadcn-svelte</small>
</div>
