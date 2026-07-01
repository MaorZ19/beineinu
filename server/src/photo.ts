/**
 * Photo → e-paper frame helpers (the sharp-dependent half of the photo path).
 *
 * Lives under server/src/ so it resolves `sharp` from server/node_modules — the
 * only place sharp is installed (same reason scripts/render-approved.ts reaches
 * through ../server/src/render). The pure dithering math lives in ./dither.ts;
 * this file just wraps sharp for decode/tone/resize and preview PNG encoding.
 */

import sharp from "sharp";
import {
  dither,
  packEpd,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  type DitherStyle,
  type GrayPlane,
} from "./dither";

/**
 * An explicit crop rectangle in pixels, measured on the image AFTER EXIF
 * auto-rotation. Overrides `gravity` — used for manual face framing since
 * sharp's `attention` gravity chases contrast (windows, clothing folds), not
 * faces, and mis-frames portraits.
 */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Tone / crop knobs for turning an arbitrary photo into an 800×480 frame. */
export interface PhotoToneOpts {
  /** Lightness multiply, 1.0 = unchanged. */
  brightness: number;
  /** Linear contrast gain centred on mid-grey, 1.0 = unchanged. */
  contrast: number;
  /** sharp gamma, 1.0–3.0, 1.0 = unchanged. */
  gamma: number;
  /** Crop focus when aspect differs (sharp position): 'attention','centre',… */
  gravity: string;
  /** true = cover-crop to fill; false = contain (white letterbox). */
  crop: boolean;
  /** Optional manual crop rect (post-EXIF pixels). Overrides `gravity`. */
  rect?: CropRect | null;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * Decode a photo file, apply tone shaping, fit to EXACTLY 800×480, and return
 * the single-channel grayscale plane (0..255, row-major) ready to dither.
 */
export async function photoToGrayPlane(
  inputPath: string,
  opts: PhotoToneOpts,
): Promise<GrayPlane> {
  // Bake in EXIF rotation first so a manual --rect is measured in the same
  // upright pixel space the user/analysis sees. `rotate()` with no args applies
  // the orientation tag; writing to a buffer flattens it so a later extract()
  // works on true post-rotation coordinates.
  const upright = await sharp(inputPath).rotate().toBuffer();

  let pipe = sharp(upright);

  if (opts.rect) {
    // Clamp the rect to the image so a slightly-oversized manual box can't throw.
    const meta = await sharp(upright).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;
    const left = Math.max(0, Math.min(opts.rect.left, imgW - 1));
    const top = Math.max(0, Math.min(opts.rect.top, imgH - 1));
    const width = Math.max(1, Math.min(opts.rect.width, imgW - left));
    const height = Math.max(1, Math.min(opts.rect.height, imgH - top));
    pipe = pipe.extract({ left, top, width, height });
  }

  const resize = opts.crop
    ? {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        fit: "cover" as const,
        // A manual rect is already framed on the face, so centre-crop the
        // leftover aspect slack; only fall back to gravity when auto-cropping.
        position: opts.rect ? "centre" : opts.gravity,
      }
    : {
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        fit: "contain" as const,
        background: { r: 255, g: 255, b: 255 },
      };

  pipe = pipe.resize(resize).grayscale();

  if (opts.gamma !== 1.0) pipe = pipe.gamma(clamp(opts.gamma, 1.0, 3.0));
  // linear(a,b): out = a*in + b. `a` is contrast gain; `b` re-centres so the
  // gain pivots on mid-grey and folds in the brightness offset.
  const a = opts.contrast;
  const b = 128 * (1 - opts.contrast) + (opts.brightness - 1) * 128;
  if (a !== 1 || b !== 0) pipe = pipe.linear(a, b);
  pipe = pipe.sharpen(); // keep edges crisp through the 1-bit crush

  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });

  if (info.width !== PANEL_WIDTH || info.height !== PANEL_HEIGHT) {
    throw new Error(`photo: unexpected raster ${info.width}x${info.height}`);
  }
  if (info.channels !== 1) {
    throw new Error(`photo: expected 1 grayscale channel, got ${info.channels}`);
  }
  return { data, width: info.width, height: info.height };
}

/** Encode a bilevel plane (0/255, 800×480) to a 1-channel preview PNG. */
export async function bilevelToPng(bilevel: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bilevel), {
    raw: { width: PANEL_WIDTH, height: PANEL_HEIGHT, channels: 1 },
  })
    .png({ colours: 2, compressionLevel: 9 })
    .toBuffer();
}

/**
 * Full one-shot: photo file + style → { epd, png }. Convenience wrapper so the
 * CLI (and any future HTTP route) doesn't repeat the dither→pack→encode dance.
 */
export async function photoToFrame(
  inputPath: string,
  style: DitherStyle,
  opts: PhotoToneOpts,
): Promise<{ epd: Buffer; png: Buffer }> {
  const gray = await photoToGrayPlane(inputPath, opts);
  const bilevel = dither(gray, style);
  const [png] = await Promise.all([bilevelToPng(bilevel)]);
  const epd = packEpd(bilevel);
  return { epd, png };
}
