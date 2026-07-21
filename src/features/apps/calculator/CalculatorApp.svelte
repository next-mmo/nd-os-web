<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";

  let calcDisplay = $state("0");
  let calcPending: ((b: number) => number) | null = $state(null);
  let calcFresh = $state(true);

  function calcInput(digit: string) {
    if (calcFresh) {
      calcDisplay = digit === "." ? "0." : digit;
      calcFresh = false;
    } else {
      if (digit === "." && calcDisplay.includes(".")) return;
      calcDisplay = calcDisplay === "0" && digit !== "." ? digit : calcDisplay + digit;
    }
  }

  function calcOperator(op: "+" | "-" | "*" | "/") {
    const current = parseFloat(calcDisplay);
    if (calcPending) {
      calcDisplay = String(calcPending(current));
    }
    const ops: Record<string, (a: number, b: number) => number> = {
      "+": (a, b) => a + b,
      "-": (a, b) => a - b,
      "*": (a, b) => a * b,
      "/": (a, b) => (b === 0 ? NaN : a / b),
    };
    calcPending = (b) => ops[op](current, b);
    calcFresh = true;
  }

  function calcEquals() {
    if (!calcPending) return;
    const current = parseFloat(calcDisplay);
    const result = calcPending(current);
    calcDisplay = Number.isFinite(result) ? String(result) : "Error";
    calcPending = null;
    calcFresh = true;
  }

  function calcClear() {
    calcDisplay = "0";
    calcPending = null;
    calcFresh = true;
  }
</script>

<div class="calc-app flex h-full flex-col gap-3 p-4">
  <div
    class="calc-display bg-muted text-foreground rounded-lg px-4 py-6 text-right text-3xl font-semibold tracking-tight"
    aria-live="polite"
  >
    {calcDisplay}
  </div>
  <div class="calc-grid grid grid-cols-4 gap-2">
    <Button variant="secondary" class="calc-key wide col-span-2" onclick={calcClear}>AC</Button>
    <Button
      variant="secondary"
      class="calc-key"
      onclick={() => {
        calcDisplay = String(parseFloat(calcDisplay) * -1);
      }}>±</Button
    >
    <Button variant="outline" class="calc-key op" onclick={() => calcOperator("/")} aria-label="Divide"
      >÷</Button
    >

    <Button variant="ghost" class="calc-key" onclick={() => calcInput("7")}>7</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("8")}>8</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("9")}>9</Button>
    <Button variant="outline" class="calc-key op" onclick={() => calcOperator("*")} aria-label="Multiply"
      >×</Button
    >

    <Button variant="ghost" class="calc-key" onclick={() => calcInput("4")}>4</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("5")}>5</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("6")}>6</Button>
    <Button variant="outline" class="calc-key op" onclick={() => calcOperator("-")} aria-label="Subtract"
      >−</Button
    >

    <Button variant="ghost" class="calc-key" onclick={() => calcInput("1")}>1</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("2")}>2</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput("3")}>3</Button>
    <Button variant="outline" class="calc-key op" onclick={() => calcOperator("+")} aria-label="Add"
      >+</Button
    >

    <Button variant="ghost" class="calc-key wide col-span-2" onclick={() => calcInput("0")}>0</Button>
    <Button variant="ghost" class="calc-key" onclick={() => calcInput(".")}>.</Button>
    <Button class="calc-key equals" onclick={calcEquals}>=</Button>
  </div>
</div>
