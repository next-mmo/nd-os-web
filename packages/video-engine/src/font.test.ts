import { describe, expect, it } from "vitest";
import { UnsupportedFontError, readFontFamily } from "./font";

type NameEntry = { platformId: number; nameId: number; value: string };

/** Builds the smallest TrueType file that carries a usable `name` table. */
function buildFont(entries: NameEntry[], sfntTag = 0x00010000): ArrayBuffer {
  const encoded = entries.map((entry) => {
    const bytes =
      entry.platformId === 1
        ? Uint8Array.from(entry.value, (c) => c.charCodeAt(0))
        : Uint8Array.from(entry.value.split("").flatMap((c) => [0, c.charCodeAt(0)]));
    return { ...entry, bytes };
  });

  const storage = encoded.reduce((sum, e) => sum + e.bytes.length, 0);
  const nameTableSize = 6 + encoded.length * 12 + storage;
  const nameOffset = 12 + 16;
  const total = nameOffset + nameTableSize;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, sfntTag);
  view.setUint16(4, 1); // numTables

  const tag = "name";
  for (let i = 0; i < 4; i++) view.setUint8(12 + i, tag.charCodeAt(i));
  view.setUint32(12 + 8, nameOffset);
  view.setUint32(12 + 12, nameTableSize);

  view.setUint16(nameOffset, 0); // format
  view.setUint16(nameOffset + 2, encoded.length);
  view.setUint16(nameOffset + 4, 6 + encoded.length * 12); // storage offset, table-relative

  let stringCursor = 0;
  encoded.forEach((entry, i) => {
    const record = nameOffset + 6 + i * 12;
    view.setUint16(record, entry.platformId);
    view.setUint16(record + 2, 1); // encodingId
    view.setUint16(record + 4, 0); // languageId
    view.setUint16(record + 6, entry.nameId);
    view.setUint16(record + 8, entry.bytes.length);
    view.setUint16(record + 10, stringCursor);
    bytes.set(entry.bytes, nameOffset + 6 + encoded.length * 12 + stringCursor);
    stringCursor += entry.bytes.length;
  });

  return buffer;
}

describe("readFontFamily", () => {
  it("reads a Windows-platform UTF-16 family name", () => {
    const font = buildFont([{ platformId: 3, nameId: 1, value: "Inter Tight" }]);
    expect(readFontFamily(font)).toBe("Inter Tight");
  });

  it("reads a Mac-platform single-byte family name", () => {
    const font = buildFont([{ platformId: 1, nameId: 1, value: "Helvetica" }]);
    expect(readFontFamily(font)).toBe("Helvetica");
  });

  it("prefers the typographic family over the legacy one", () => {
    // Legacy name 1 splits large families into "Inter Semibold" style buckets;
    // name 16 is the one libass should be asked for.
    const font = buildFont([
      { platformId: 3, nameId: 1, value: "Inter Semibold" },
      { platformId: 3, nameId: 16, value: "Inter" },
    ]);
    expect(readFontFamily(font)).toBe("Inter");
  });

  it("rejects WOFF, which freetype in this build cannot read", () => {
    const buffer = new ArrayBuffer(64);
    new Uint8Array(buffer).set([0x77, 0x4f, 0x46, 0x46]); // "wOFF"
    expect(() => readFontFamily(buffer)).toThrow(UnsupportedFontError);
    expect(() => readFontFamily(buffer)).toThrow(/WOFF/i);
  });

  it("rejects font collections", () => {
    const buffer = new ArrayBuffer(64);
    new Uint8Array(buffer).set([0x74, 0x74, 0x63, 0x66]); // "ttcf"
    expect(() => readFontFamily(buffer)).toThrow(/collection/i);
  });

  it("rejects a file with no name table", () => {
    const buffer = new ArrayBuffer(12);
    new DataView(buffer).setUint32(0, 0x00010000);
    expect(() => readFontFamily(buffer)).toThrow(UnsupportedFontError);
  });
});
