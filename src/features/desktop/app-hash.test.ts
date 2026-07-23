import { describe, expect, it } from "vitest";
import { appFromHash, hashForApp } from "./app-hash";

describe("app-hash", () => {
  it("maps poker to #texas-poker", () => {
    expect(hashForApp("poker")).toBe("texas-poker");
    expect(appFromHash("#texas-poker")).toBe("poker");
    expect(appFromHash("texas-poker")).toBe("poker");
    expect(appFromHash("#poker")).toBe("poker");
  });

  it("resolves plain app ids", () => {
    expect(appFromHash("#settings")).toBe("settings");
    expect(hashForApp("settings")).toBe("settings");
  });

  it("returns null for unknown hashes", () => {
    expect(appFromHash("#nope")).toBeNull();
    expect(appFromHash("")).toBeNull();
  });
});
