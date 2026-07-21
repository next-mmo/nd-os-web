<script lang="ts">
  import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "$lib/components/ui/empty/index.js";
</script>

<div class="flex h-full items-center justify-center p-6">
  <Empty class="border-border max-w-md rounded-[12px] border">
    <EmptyHeader>
      <EmptyTitle>Batch Generation</EmptyTitle>
      <EmptyDescription>
        Queue multiple scripts and voices in a later milestone. Use Studio segments for now.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
</div>
