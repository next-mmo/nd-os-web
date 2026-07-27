import { describe, expect, it } from "vitest";
import { crc32, createZip } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

async function readZip(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

describe("crc32", () => {
  it("matches the reference checksums", () => {
    expect(crc32(bytes("hello"))).toBe(0x3610a686);
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("createZip", () => {
  const modified = new Date(2026, 0, 2, 3, 4, 5);

  it("writes a well-formed archive", async () => {
    const zip = createZip(
      [
        { name: "frame_0001.jpg", data: bytes("first") },
        { name: "frame_0002.jpg", data: bytes("second") },
      ],
      modified,
    );
    const view = await readZip(zip);

    expect(view.getUint32(0, true)).toBe(0x04034b50); // local file header
    // End-of-central-directory sits in the last 22 bytes when there is no comment.
    const eocd = view.byteLength - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 8, true)).toBe(2); // entries on this disk
    expect(view.getUint16(eocd + 10, true)).toBe(2); // entries total

    const centralOffset = view.getUint32(eocd + 16, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    // The recorded central-directory size must reach exactly the EOCD record.
    expect(centralOffset + view.getUint32(eocd + 12, true)).toBe(eocd);
  });

  it("stores entries uncompressed with a matching CRC and size", async () => {
    const data = bytes("first");
    const view = await readZip(createZip([{ name: "a.jpg", data }], modified));

    expect(view.getUint16(8, true)).toBe(0); // method 0 = stored
    expect(view.getUint32(14, true)).toBe(crc32(data));
    expect(view.getUint32(18, true)).toBe(data.length); // compressed
    expect(view.getUint32(22, true)).toBe(data.length); // uncompressed
    expect(view.getUint16(26, true)).toBe("a.jpg".length);
  });

  it("points each central-directory entry at its local header", async () => {
    const first = bytes("first");
    const zip = createZip(
      [
        { name: "a.jpg", data: first },
        { name: "b.jpg", data: bytes("second") },
      ],
      modified,
    );
    const view = await readZip(zip);
    const eocd = view.byteLength - 22;
    const central = view.getUint32(eocd + 16, true);

    expect(view.getUint32(central + 42, true)).toBe(0);
    // Second local header starts after the first header, name and payload.
    expect(view.getUint32(central + 46 + 5 + 42, true)).toBe(30 + 5 + first.length);
  });

  it("handles an empty archive", async () => {
    const view = await readZip(createZip([], modified));
    expect(view.byteLength).toBe(22);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(8, true)).toBe(0);
  });
});
