import Dexie, { type EntityTable } from "dexie";

/**
 * The bundled ffmpeg core has libass and freetype but no fonts and no
 * fontconfig, so text overlays and burned-in captions need a font supplied by
 * the user. Caching them here makes that a one-time step per device.
 */
export type FontRecord = {
  /** The family name read out of the font file, which is what libass matches on. */
  id: string;
  fileName: string;
  data: ArrayBuffer;
  addedAt: number;
};

class VideoDatabase extends Dexie {
  fonts!: EntityTable<FontRecord, "id">;

  constructor() {
    super("nd-os-video-toolkit");
    this.version(1).stores({ fonts: "id, addedAt" });
  }
}

export const videoDb = new VideoDatabase();

export async function listFonts(): Promise<FontRecord[]> {
  return videoDb.fonts.orderBy("addedAt").reverse().toArray();
}

export async function saveFont(record: FontRecord): Promise<void> {
  await videoDb.fonts.put(record);
}

export async function deleteFont(id: string): Promise<void> {
  await videoDb.fonts.delete(id);
}
