import { describe, expect, it } from "vitest";
import { validateGgufBlob } from "./index";

function ggufHeader(version: number): Blob {
  const bytes = new Uint8Array(8);
  bytes.set([0x47, 0x47, 0x55, 0x46]);
  new DataView(bytes.buffer).setUint32(4, version, true);
  return new Blob([bytes]);
}

describe("validateGgufBlob", () => {
  it("accepts a version 3 GGUF header", async () => {
    await expect(validateGgufBlob(ggufHeader(3))).resolves.toEqual({ ok: true, version: 3 });
  });

  it("rejects renamed non-GGUF data", async () => {
    const result = await validateGgufBlob(new Blob(["not a gguf model"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("valid GGUF header");
  });

  it("rejects unsupported GGUF versions", async () => {
    const result = await validateGgufBlob(ggufHeader(99));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unsupported GGUF version 99");
  });
});
