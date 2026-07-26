<script lang="ts">
  import { formatDuration, parseTimecode, toTimecode, type OptionSpec } from "@nd-os/video-engine";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import * as Select from "$lib/components/ui/select/index.js";

  type Props = {
    spec: OptionSpec;
    value: string | number | boolean;
    /** Source length, used to bound `time` fields. */
    duration: number;
    onchange: (value: string | number | boolean) => void;
  };

  let { spec, value, duration, onchange }: Props = $props();

  // The same component instance is reused as the tool's option list changes.
  const fieldId = $derived(`opt-${spec.id}`);

  // A `time` value of 0 on an end field means "run to the end of the clip", so
  // the control shows the full duration until the user moves it.
  const timeValue = $derived(
    spec.kind === "time" && spec.endOfClip && Number(value) === 0 ? duration : Number(value),
  );

  let timeText = $state("");
  $effect(() => {
    timeText = toTimecode(timeValue);
  });

  function commitTimeText() {
    const parsed = parseTimecode(timeText);
    if (Number.isNaN(parsed)) {
      timeText = toTimecode(timeValue);
      return;
    }
    onchange(Math.min(Math.max(0, parsed), duration || parsed));
  }

  const selectedLabel = $derived(
    spec.kind === "select"
      ? (spec.choices.find((c) => c.value === String(value))?.label ?? "Choose…")
      : "",
  );
</script>

<div class="flex flex-col gap-1.5">
  {#if spec.kind === "switch"}
    <div class="flex items-center justify-between gap-3">
      <Label for={fieldId} class="cursor-pointer text-xs font-medium">{spec.label}</Label>
      <Switch
        id={fieldId}
        checked={value === true}
        onCheckedChange={(checked) => onchange(checked)}
      />
    </div>
  {:else}
    <div class="flex items-baseline justify-between gap-2">
      <Label for={fieldId} class="text-xs font-medium">{spec.label}</Label>
      {#if spec.kind === "range"}
        <span class="text-muted-foreground font-mono text-[11px]">
          {spec.describe ? spec.describe(Number(value)) : `${value}${spec.unit ?? ""}`}
        </span>
      {:else if spec.kind === "time"}
        <span class="text-muted-foreground font-mono text-[11px]">
          {formatDuration(timeValue, true)}
        </span>
      {/if}
    </div>
  {/if}

  {#if spec.kind === "select"}
    <Select.Root type="single" value={String(value)} onValueChange={(v) => v && onchange(v)}>
      <Select.Trigger id={fieldId} class="w-full" size="sm">{selectedLabel}</Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each spec.choices as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label}>
              <div class="flex flex-col">
                <span>{choice.label}</span>
                {#if choice.hint}
                  <span class="text-muted-foreground text-[11px]">{choice.hint}</span>
                {/if}
              </div>
            </Select.Item>
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  {:else if spec.kind === "range"}
    <input
      id={fieldId}
      type="range"
      class="accent-primary h-4 w-full cursor-pointer"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={Number(value)}
      oninput={(e) => onchange(Number(e.currentTarget.value))}
    />
  {:else if spec.kind === "time"}
    <div class="flex items-center gap-2">
      <input
        id={fieldId}
        type="range"
        class="accent-primary h-4 min-w-0 flex-1 cursor-pointer"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.05}
        value={timeValue}
        disabled={duration <= 0}
        oninput={(e) => onchange(Number(e.currentTarget.value))}
      />
      <Input
        class="h-7 w-[104px] shrink-0 font-mono text-[11px]"
        bind:value={timeText}
        onblur={commitTimeText}
        onkeydown={(e) => e.key === "Enter" && commitTimeText()}
        aria-label={`${spec.label} timecode`}
      />
    </div>
  {:else if spec.kind === "number"}
    <Input
      id={fieldId}
      type="number"
      class="h-8"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={Number(value)}
      oninput={(e) => onchange(Number(e.currentTarget.value))}
    />
  {:else if spec.kind === "color"}
    <div class="flex items-center gap-2">
      <input
        id={fieldId}
        type="color"
        class="border-input h-8 w-12 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
        value={String(value)}
        oninput={(e) => onchange(e.currentTarget.value)}
      />
      <Input
        class="h-8 font-mono text-xs"
        value={String(value)}
        oninput={(e) => onchange(e.currentTarget.value)}
        aria-label={`${spec.label} hex value`}
      />
    </div>
  {:else if spec.kind === "text"}
    {#if spec.multiline}
      <Textarea
        id={fieldId}
        rows={3}
        placeholder={spec.placeholder}
        value={String(value)}
        oninput={(e) => onchange(e.currentTarget.value)}
      />
    {:else}
      <Input
        id={fieldId}
        class="h-8"
        placeholder={spec.placeholder}
        value={String(value)}
        oninput={(e) => onchange(e.currentTarget.value)}
      />
    {/if}
  {/if}

  {#if spec.hint}
    <p class="text-muted-foreground text-[11px] leading-snug">{spec.hint}</p>
  {/if}
</div>
