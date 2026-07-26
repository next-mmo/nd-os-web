/**
 * The bundled ffmpeg core has libass but no fontconfig, so libass can only
 * find a font by the family name recorded in the file itself. Reading the
 * `name` table lets us pass a matching `FontName=` to `force_style`.
 */

const NAME_ID_FAMILY = 1;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;

export class UnsupportedFontError extends Error {}

export function readFontFamily(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new UnsupportedFontError("That file is too small to be a font.");

  const tag = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (tag === "wOFF" || tag === "wOF2") {
    throw new UnsupportedFontError("WOFF fonts are not supported — use a .ttf or .otf file.");
  }
  if (tag === "ttcf") {
    throw new UnsupportedFontError("Font collections (.ttc) are not supported — use a .ttf or .otf file.");
  }

  const numTables = view.getUint16(4);
  let nameOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > view.byteLength) break;
    const name = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    if (name === "name") {
      nameOffset = view.getUint32(record + 8);
      break;
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > view.byteLength) {
    throw new UnsupportedFontError("That file does not look like a TrueType or OpenType font.");
  }

  const count = view.getUint16(nameOffset + 2);
  const storageOffset = nameOffset + view.getUint16(nameOffset + 4);

  let family = "";
  let typographic = "";

  for (let i = 0; i < count; i++) {
    const record = nameOffset + 6 + i * 12;
    if (record + 12 > view.byteLength) break;
    const platformId = view.getUint16(record);
    const nameId = view.getUint16(record + 6);
    if (nameId !== NAME_ID_FAMILY && nameId !== NAME_ID_TYPOGRAPHIC_FAMILY) continue;

    const length = view.getUint16(record + 8);
    const offset = storageOffset + view.getUint16(record + 10);
    if (offset + length > view.byteLength) continue;

    const bytes = new Uint8Array(buffer, offset, length);
    // Platform 3 (Windows) and 0 (Unicode) store UTF-16BE; platform 1 (Mac)
    // uses a single-byte encoding close enough to Latin-1 for family names.
    const value =
      platformId === 1
        ? String.fromCharCode(...bytes)
        : decodeUtf16Be(bytes);
    const cleaned = value.replace(/\0/g, "").trim();
    if (!cleaned) continue;

    if (nameId === NAME_ID_TYPOGRAPHIC_FAMILY && !typographic) typographic = cleaned;
    if (nameId === NAME_ID_FAMILY && !family) family = cleaned;
  }

  const resolved = typographic || family;
  if (!resolved) throw new UnsupportedFontError("Could not read a family name from that font.");
  return resolved;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}
