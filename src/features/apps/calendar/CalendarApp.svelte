<script lang="ts">
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let calCursor = $state(new Date());

  function calMatrix(date: Date): { day: number | null; today: boolean }[][] {
    const year = date.getFullYear();
    const month = date.getMonth();
    const today = new Date();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: number | null; today: boolean }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, today: false });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        today:
          d === today.getDate() &&
          month === today.getMonth() &&
          year === today.getFullYear(),
      });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, today: false });
    const rows: { day: number | null; today: boolean }[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }

  function calPrev() {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  }

  function calNext() {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  }

  function calToday() {
    calCursor = new Date();
  }
</script>

<div class="cal-app flex h-full flex-col gap-3 p-4">
  <div class="cal-header flex items-center gap-2">
    <Button variant="outline" size="icon-sm" onclick={calPrev} aria-label="Previous month">
      <ChevronLeftIcon />
    </Button>
    <strong class="min-w-0 flex-1 text-center">
      {calCursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
    </strong>
    <Button variant="outline" size="icon-sm" onclick={calNext} aria-label="Next month">
      <ChevronRightIcon />
    </Button>
    <Button variant="secondary" size="sm" onclick={calToday}>Today</Button>
  </div>
  <div class="cal-weekdays text-muted-foreground grid grid-cols-7 gap-1 text-center text-xs">
    {#each ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as d}
      <span>{d}</span>
    {/each}
  </div>
  <div class="cal-grid grid grid-cols-7 gap-1">
    {#each calMatrix(calCursor) as week}
      {#each week as cell}
        <div
          class={cn(
            "cal-cell flex aspect-square items-center justify-center rounded-md text-sm",
            cell.today && "bg-primary text-primary-foreground font-semibold",
            !cell.day && "text-muted-foreground/40",
          )}
        >
          {cell.day ?? ""}
        </div>
      {/each}
    {/each}
  </div>
</div>
