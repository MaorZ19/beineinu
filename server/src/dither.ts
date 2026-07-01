/**
 * Photo → 1-bit e-paper dithering for the Maori Ink Screen.
 *
 * The quote frames are pure-threshold black/white (crisp text). PHOTOS need
 * error-diffusion / halftone dithering instead — a hard threshold on a face
 * just produces a black blob. This module turns an 800×480 grayscale raster
 * (one byte/px, 0=black..255=white, row-major, no alpha) into a packed 1-bit
 * EPD buffer using one of several dithering styles.
 *
 * The output packing convention is IDENTICAL to render.ts (the quote path), so
 * a photo frame is indistinguishable from a quote frame to the firmware:
 *   800×480, 48,000 bytes, MSB-first, row-major, bit=1 → WHITE, bit=0 → BLACK.
 *
 * All functions here are pure (no I/O) so they're trivially testable. The
 * caller (photo-to-epd.ts) handles decode/resize/crop via sharp and the file
 * writes.
 */

/** Panel geometry — fixed by the Seeed 7.5" UC8179 hardware. */
export const PANEL_WIDTH = 800 as const;
export const PANEL_HEIGHT = 480 as const;
const BYTES_PER_ROW = PANEL_WIDTH / 8; // 100
export const EPD_BUFFER_BYTES = (PANEL_WIDTH * PANEL_HEIGHT) / 8; // 48,000

/** Supported dithering styles. */
export type DitherStyle =
  | "floyd-steinberg"
  | "atkinson"
  | "halftone"
  | "threshold";

export const DITHER_STYLES: readonly DitherStyle[] = [
  "floyd-steinberg",
  "atkinson",
  "halftone",
  "threshold",
] as const;

/**
 * A grayscale plane: `data` is width*height bytes (0..255), row-major.
 * Matches sharp's `.grayscale().raw()` output.
 */
export interface GrayPlane {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
}

/**
 * Error-diffusion dithering with a configurable kernel. Works on a Float32
 * copy of the plane so accumulated error stays precise, then hard-decides each
 * pixel and spreads its quantisation error to not-yet-visited neighbours.
 *
 * Returns a Uint8Array of width*height bytes, each 0 (black) or 255 (white).
 */
function errorDiffuse(
  gray: GrayPlane,
  kernel: readonly { dx: number; dy: number; w: number }[],
  divisor: number,
): Uint8Array {
  const { width, height } = gray;
  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) buf[i] = gray.data[i];

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const next = old < 128 ? 0 : 255;
      out[i] = next;
      const err = old - next;
      if (err === 0) continue;
      for (const k of kernel) {
        const nx = x + k.dx;
        const ny = y + k.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        buf[ny * width + nx] += (err * k.w) / divisor;
      }
    }
  }
  return out;
}

/** Floyd–Steinberg kernel (7/16, 3/16, 5/16, 1/16). Classic photographic look. */
const FS_KERNEL = [
  { dx: 1, dy: 0, w: 7 },
  { dx: -1, dy: 1, w: 3 },
  { dx: 0, dy: 1, w: 5 },
  { dx: 1, dy: 1, w: 1 },
] as const;

/**
 * Atkinson kernel — the original 1984 Mac dither. Only diffuses 6/8 of the
 * error (divisor 8, six taps of weight 1), which "loses" contrast into
 * cleaner whites/blacks. Higher-contrast, less noisy, retro-Mac look.
 */
const ATKINSON_KERNEL = [
  { dx: 1, dy: 0, w: 1 },
  { dx: 2, dy: 0, w: 1 },
  { dx: -1, dy: 1, w: 1 },
  { dx: 0, dy: 1, w: 1 },
  { dx: 1, dy: 1, w: 1 },
  { dx: 0, dy: 2, w: 1 },
] as const;

/**
 * Clustered-dot halftone via an ordered dither matrix. Produces a comic /
 * newsprint dot pattern rather than photographic noise. We use an 8×8 Bayer
 * matrix scaled to 0..255 as per-pixel thresholds — cheap, deterministic, and
 * gives that pop-art print feel.
 */
const BAYER8 = buildBayer8();

function buildBayer8(): Float32Array {
  // Standard recursive Bayer construction to 8×8, normalised to (0,1).
  const base2 = [
    [0, 2],
    [3, 1],
  ];
  function grow(m: number[][]): number[][] {
    const n = m.length;
    const out: number[][] = Array.from({ length: n * 2 }, () =>
      new Array(n * 2).fill(0),
    );
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        out[y][x] = v + 0;
        out[y][x + n] = v + 2;
        out[y + n][x] = v + 3;
        out[y + n][x + n] = v + 1;
      }
    }
    return out;
  }
  let m = base2;
  m = grow(m); // 4×4
  m = grow(m); // 8×8
  const size = m.length;
  const denom = size * size; // 64
  const flat = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map matrix cell to a 0..255 threshold; +0.5 centres the level.
      flat[y * size + x] = ((m[y][x] + 0.5) / denom) * 255;
    }
  }
  return flat;
}

function ordered(gray: GrayPlane): Uint8Array {
  const { width, height, data } = gray;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = BAYER8[(y & 7) * 8 + (x & 7)];
      const i = y * width + x;
      out[i] = data[i] < t ? 0 : 255;
    }
  }
  return out;
}

/** Plain hard threshold at 128 — same as the quote path, for comparison. */
function hardThreshold(gray: GrayPlane): Uint8Array {
  const { width, height, data } = gray;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = data[i] < 128 ? 0 : 255;
  return out;
}

/**
 * Dither an 800×480 grayscale plane to a bilevel plane (0/255 per pixel) in the
 * chosen style. Returns width*height bytes, row-major.
 */
export function dither(gray: GrayPlane, style: DitherStyle): Uint8Array {
  switch (style) {
    case "floyd-steinberg":
      return errorDiffuse(gray, FS_KERNEL, 16);
    case "atkinson":
      return errorDiffuse(gray, ATKINSON_KERNEL, 8);
    case "halftone":
      return ordered(gray);
    case "threshold":
      return hardThreshold(gray);
    default: {
      const _exhaustive: never = style;
      throw new Error(`unknown dither style: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Pack a bilevel plane (0=black, 255=white, width*height bytes) into the raw
 * 48,000-byte EPD framebuffer. MSB-first, row-major, bit=1 → WHITE, bit=0 →
 * BLACK — VERBATIM the convention in render.ts so photo frames and quote frames
 * are byte-compatible.
 */
export function packEpd(
  bilevel: Uint8Array,
  width = PANEL_WIDTH,
  height = PANEL_HEIGHT,
): Buffer {
  if (width !== PANEL_WIDTH || height !== PANEL_HEIGHT) {
    throw new Error(
      `packEpd: expected ${PANEL_WIDTH}x${PANEL_HEIGHT}, got ${width}x${height}`,
    );
  }
  const out = Buffer.alloc(EPD_BUFFER_BYTES, 0xff); // start fully WHITE
  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = y * BYTES_PER_ROW;
    for (let x = 0; x < width; x++) {
      if (bilevel[srcRow + x] === 0) {
        const byteIndex = dstRow + (x >> 3);
        const bitMask = 0x80 >> (x & 7); // MSB-first
        out[byteIndex] &= ~bitMask; // clear bit → BLACK
      }
    }
  }
  return out;
}
