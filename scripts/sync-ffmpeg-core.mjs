/**
 * Stages the ffmpeg.wasm core into `public/ffmpeg/`.
 *
 * These files must be served byte-for-byte. Importing them through Vite (even
 * with `?url`) routes the loader through the JS transform pipeline, which
 * injects the HMR client — and that client touches `document`, so every
 * emscripten pthread worker throws on startup and `load()` hangs forever.
 * `public/` is copied verbatim, which is exactly what the core needs.
 *
 * The assets are gitignored and regenerated from node_modules on demand, so a
 * 31 MB binary never lands in the repository.
 *
 * The single-threaded core is deliberate. `@ffmpeg/core-mt` deadlocks on the
 * first `pthread_create` on machines that report a high core count — every
 * transcode hangs after "Stream mapping" while its fixed emscripten thread
 * pool never yields a worker. The single-threaded build has no pool, needs no
 * cross-origin isolation, and finishes reliably.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "ffmpeg");

const FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm"];

async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return -1;
  }
}

async function main() {
  let srcDir;
  try {
    // The package only exports "." and "./wasm", so a deep require is refused;
    // ESM resolution of "." lands on dist/esm/ffmpeg-core.js, and the wasm
    // sits beside it.
    srcDir = path.dirname(fileURLToPath(import.meta.resolve("@ffmpeg/core")));
  } catch {
    console.error(
      "[ffmpeg] @ffmpeg/core is not installed. Run `pnpm install` before starting the dev server.",
    );
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  let copied = 0;
  for (const name of FILES) {
    const from = path.join(srcDir, name);
    const to = path.join(outDir, name);
    const [fromSize, toSize] = await Promise.all([sizeOf(from), sizeOf(to)]);
    if (fromSize < 0) {
      console.error(`[ffmpeg] missing ${from}`);
      process.exit(1);
    }
    if (fromSize === toSize) continue;
    await copyFile(from, to);
    copied += 1;
  }
  console.log(
    copied ? `[ffmpeg] staged ${copied} core file(s) into public/ffmpeg` : "[ffmpeg] core up to date",
  );
}

await main();
