/**
 * Minimal ZIP writer, used to hand back frame exports as a single download.
 * Entries are stored uncompressed — the payloads are already-compressed JPEG
 * or PNG, so deflate would cost time for nothing.
 */

export type ZipEntry = { name: string; data: Uint8Array };

/**
 * `Uint8Array` is generic over its backing buffer, and a SharedArrayBuffer-backed
 * view is not a valid `BlobPart`. Re-wrapping pins the type without copying in
 * the common case.
 */
function asBlobPart(data: Uint8Array): BlobPart {
  const buffer = data.buffer;
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time, which is what the ZIP header format expects. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[], modified = new Date()): Blob {
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let centralSize = 0;
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, 0, true); // method: stored
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true); // compressed size
    localView.setUint32(22, entry.data.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);

    parts.push(local, asBlobPart(entry.data));

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true); // central directory signature
    headerView.setUint16(4, 20, true); // version made by
    headerView.setUint16(6, 20, true); // version needed
    headerView.setUint16(8, 0, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, time, true);
    headerView.setUint16(14, date, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, entry.data.length, true);
    headerView.setUint32(24, entry.data.length, true);
    headerView.setUint16(28, nameBytes.length, true);
    headerView.setUint16(30, 0, true); // extra
    headerView.setUint16(32, 0, true); // comment
    headerView.setUint16(34, 0, true); // disk number
    headerView.setUint16(36, 0, true); // internal attrs
    headerView.setUint32(38, 0, true); // external attrs
    headerView.setUint32(42, offset, true); // offset of local header
    header.set(nameBytes, 46);
    central.push(header);
    centralSize += header.length;

    offset += local.length + entry.data.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central directory signature
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
