<script lang="ts">
  import { onMount } from "svelte";
  import { videoStore } from "@/features/video/stores/video.store.svelte";
  import VideoShell from "./components/VideoShell.svelte";

  onMount(() => {
    void videoStore.boot();
  });
</script>

<VideoShell />
