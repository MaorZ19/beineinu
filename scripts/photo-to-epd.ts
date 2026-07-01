import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
// Import through ../server/src so `sharp` resolves from server/node_modules
// (the only place it's installed) — same pattern as render-approved.ts.
import {
  DITHER_STYLES,
  dither,
  packEpd,
  type DitherStyle,
} from "../server/src/dither";
import {
  photoToGrayPlane,
  bilevelToPng,
  type PhotoToneOpts,
  type CropRect,
} from "../server/src/photo";

/**
 * Turn a family photo into e-paper frames the Maori Ink Screen can show.
 *
 * The screen is "dumb": it draws any 48,000-byte 1-bit frame in the pool at
 * random. A dithered photo is just another frame. This script does the whole
 * conversion — smart crop to 800×480, tone adjustment, and dithering — and
 * writes .epd (for the panel) + .png (preview) for one or all styles.
 *
 *   # compare ALL styles for one photo (writes to .tmp/photo-samples/):
 *   npx tsx scripts/photo-to-epd.ts samples ./photo.jpg
 *
 *   # commit ONE style into the live render pool (.tmp/rendered/, gets rsynced):
 *   npx tsx scripts/photo-to-epd.ts add ./photo.jpg --style floyd-steinberg
 *
 * Tone flags (photos usually want a small nudge to read well in 1-bit):
 *   --brightness <n>  multiply lightness   (default 1.0)
 *   --contrast   <n>  linear contrast gain (default 1.08)
 *   --gamma      <n>  sharp gamma 1.0–3.0  (default 1.0)
 *   --gravity <pos>   crop focus when aspect differs: attention (default),
 *                     centre, north, south, east, west
 *   --rect x,y,w,h    MANUAL crop box (post-EXIF pixels) — overrides gravity.
 *                     Use this to frame a face; `attention` chases contrast,
 *                     not faces, and mis-crops portraits.
 *   --no-crop         letterbox (fit inside, white bars) instead of cover-crop
 */

const SAMPLES_OUT = ".tmp/photo-samples";
const POOL_OUT = ".tmp/rendered";

interface Opts extends PhotoToneOpts {
  mode: "samples" | "add";
  input: string;
  style: DitherStyle | "all";
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv: string[]): Opts {
  const [mode, input, ...rest] = argv;
  if (mode !== "samples" && mode !== "add") {
    fail(
      `usage:\n` +
        `  npx tsx scripts/photo-to-epd.ts samples <photo>            # compare all styles\n` +
        `  npx tsx scripts/photo-to-epd.ts add <photo> --style <s>    # commit one style to the pool\n` +
        `styles: ${DITHER_STYLES.join(", ")}`,
    );
  }
  if (!input) fail("no photo path given");
  if (!existsSync(input)) fail(`file not found: ${input}`);

  const flag = (name: string, def: string): string => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
  };
  const has = (name: string): boolean => rest.includes(`--${name}`);

  const styleRaw = flag("style", mode === "add" ? "floyd-steinberg" : "all");
  if (styleRaw !== "all" && !DITHER_STYLES.includes(styleRaw as DitherStyle)) {
    fail(
      `unknown --style '${styleRaw}'. options: ${DITHER_STYLES.join(", ")}, all`,
    );
  }

  const num = (name: string, def: string): number => {
    const v = Number(flag(name, def));
    if (Number.isNaN(v)) fail(`--${name} must be a number`);
    return v;
  };

  let rect: CropRect | null = null;
  const rectRaw = flag("rect", "");
  if (rectRaw) {
    const parts = rectRaw.split(",").map((n) => Number(n.trim()));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0)) {
      fail(`--rect must be "x,y,w,h" (non-negative pixels), got '${rectRaw}'`);
    }
    const [left, top, width, height] = parts;
    if (width < 1 || height < 1) fail(`--rect width/height must be >= 1`);
    rect = { left, top, width, height };
  }

  return {
    mode,
    input,
    style: styleRaw as DitherStyle | "all",
    brightness: num("brightness", "1.0"),
    contrast: num("contrast", "1.08"),
    gamma: num("gamma", "1.0"),
    gravity: flag("gravity", "attention"),
    crop: !has("no-crop"),
    rect,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const gray = await photoToGrayPlane(opts.input, opts);

  const stem = basename(opts.input, extname(opts.input)).replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const styles: DitherStyle[] =
    opts.style === "all" ? [...DITHER_STYLES] : [opts.style as DitherStyle];

  if (opts.mode === "samples") {
    mkdirSync(SAMPLES_OUT, { recursive: true });
    console.log(
      `\nRendering ${styles.length} style(s) for "${basename(opts.input)}" → ${SAMPLES_OUT}/\n`,
    );
    for (const style of styles) {
      const bilevel = dither(gray, style);
      const png = await bilevelToPng(bilevel);
      const epd = packEpd(bilevel);
      const pngPath = join(SAMPLES_OUT, `${stem}.${style}.png`);
      const epdPath = join(SAMPLES_OUT, `${stem}.${style}.epd`);
      writeFileSync(pngPath, png);
      writeFileSync(epdPath, epd);
      console.log(
        `  ${style.padEnd(16)} → ${pngPath}  (epd ${statSync(epdPath).size}B)`,
      );
    }
    console.log(
      `\nOpen the .png files to compare. Pick a style, then:\n` +
        `  npx tsx scripts/photo-to-epd.ts add "${opts.input}" --style <style>\n`,
    );
    return;
  }

  // mode === "add": commit ONE style into the live render pool as a photo frame.
  if (opts.style === "all") fail("`add` needs a single --style, not 'all'");
  const style = styles[0];
  mkdirSync(POOL_OUT, { recursive: true });
  const bilevel = dither(gray, style);
  const png = await bilevelToPng(bilevel);
  const epd = packEpd(bilevel);
  // `photo-` prefix keeps photo frames easy to spot / prune and clear of the
  // numeric quote ids sharing the pool.
  const id = `photo-${stem}`;
  writeFileSync(join(POOL_OUT, `${id}.epd`), epd);
  writeFileSync(join(POOL_OUT, `${id}.png`), png);
  console.log(
    `\nAdded photo frame to the pool:\n` +
      `  ${POOL_OUT}/${id}.epd  (${epd.length}B, style=${style})\n` +
      `  ${POOL_OUT}/${id}.png  (preview)\n\n` +
      `Next: rsync .tmp/rendered/ to the VPS (see README "Adding more quotes").\n` +
      `The wall screen mixes it into rotation on its next 12-min wake.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
