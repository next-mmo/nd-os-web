<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { DAILY_CLAIM_AMOUNT } from "../store/profile";

  type Mode = "ready" | "success" | "already";

  type Props = {
    open?: boolean;
    mode: Mode;
    amount?: number;
    bankroll?: number;
    onOpenChange: (open: boolean) => void;
    onClaim: () => void;
  };

  let {
    open = false,
    mode,
    amount = DAILY_CLAIM_AMOUNT,
    bankroll = 0,
    onOpenChange,
    onClaim,
  }: Props = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    {#if mode === "success"}
      <Dialog.Header class="items-center text-center sm:items-center sm:text-center">
        <div
          class="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-3xl"
          aria-hidden="true"
        >
          ♠
        </div>
        <Dialog.Title>Daily claim collected</Dialog.Title>
        <Dialog.Description>
          You received
          <span class="text-foreground font-semibold">+{amount.toLocaleString()}</span> chips.
        </Dialog.Description>
      </Dialog.Header>
      <div class="bg-muted/50 my-2 rounded-xl border px-4 py-3 text-center">
        <div class="text-muted-foreground text-xs">Bankroll</div>
        <div class="text-2xl font-semibold tabular-nums">{bankroll.toLocaleString()}</div>
      </div>
      <Dialog.Footer class="sm:justify-center">
        <Button onclick={() => onOpenChange(false)}>Nice</Button>
      </Dialog.Footer>
    {:else if mode === "already"}
      <Dialog.Header>
        <Dialog.Title>Already claimed today</Dialog.Title>
        <Dialog.Description>
          Come back tomorrow for another +{DAILY_CLAIM_AMOUNT.toLocaleString()} chips. Resets at
          midnight local time.
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => onOpenChange(false)}>Got it</Button>
      </Dialog.Footer>
    {:else}
      <Dialog.Header>
        <Dialog.Title>Daily bankroll claim</Dialog.Title>
        <Dialog.Description>
          Collect free entertainment chips once per day. Adds on top of your current stack.
        </Dialog.Description>
      </Dialog.Header>
      <div class="bg-muted/50 my-2 rounded-xl border px-4 py-4 text-center">
        <div class="text-muted-foreground text-xs">Today’s reward</div>
        <div class="text-3xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          +{DAILY_CLAIM_AMOUNT.toLocaleString()}
        </div>
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => onOpenChange(false)}>Later</Button>
        <Button onclick={onClaim}>Claim chips</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
