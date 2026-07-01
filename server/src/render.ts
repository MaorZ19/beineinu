/**
 * Render core for the Maori Ink Screen e-paper keepsake.
 *
 * Takes a curated quote, builds the LOCKED 800×480 keepsake HTML via the shared
 * `renderQuoteHtml` template (imported from the Next app so the screen and the
 * marketing site can never drift), screenshots it with a SHARED headless
 * Chromium, and emits either:
 *   - a 1-bit-thresholded PNG (for previews / the Vercel app), or
 *   - the RAW packed framebuffer the UC8179 panel expects (for the ESP32).
 *
 * The Chromium browser is a lazily-initialised singleton reused across every
 * request — launching Chromium per render would dominate latency and exhaust
 * memory under concurrency. A small async mutex guards the first launch so two
 * concurrent cold calls cannot double-launch.
 *
 * ── EPD BUFFER CONVENTION (firmware author: match this VERBATIM) ─────────────
 *   Panel:        800 × 480 = 384,000 px
 *   Buffer size:  48,000 bytes (384,000 / 8)
 *   Bit depth:    1 bit/pixel
 *   Bit order:    MSB-first — bit 7 of byte 0 is the TOP-LEFT pixel (x=0,y=0),
 *                 bit 6 is (x=1,y=0), … bit 0 is (x=7,y=0), then byte 1 holds
 *                 x=8..15, etc.
 *   Layout:       row-major. Row y occupies bytes [y*100 .. y*100+99]
 *                 (800 px / 8 = 100 bytes per row). Rows top→bottom.
 *   Polarity:     bit = 1  → WHITE pixel
 *                 bit = 0  → BLACK pixel
 *   This is the standard GxEPD/UC8179 full-buffer convention: a cleared (all
 *   0xFF) buffer is a fully WHITE screen; setting a bit to 0 inks that pixel.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import sharp from "sharp";
// The locked keepsake template — kept in sync with the Next app's
// src/lib/render-template.ts (same file, copied into the server image so it
// builds standalone with rootDir=src). DO NOT fork the design here.
import { renderQuoteHtml } from "./lib/render-template";

/** Panel geometry — fixed by the Seeed 7.5" UC8179 hardware. */
const PANEL_WIDTH = 800 as const;
const PANEL_HEIGHT = 480 as const;
/** 1 bit/px, MSB-first → 8 px per byte. */
const BYTES_PER_ROW = PANEL_WIDTH / 8; // 100
const EPD_BUFFER_BYTES = (PANEL_WIDTH * PANEL_HEIGHT) / 8; // 48,000
/** Threshold cutoff: <128 → black, >=128 → white. */
const THRESHOLD = 128 as const;

/**
 * Input shape for a render. `displayBody` is the curated/cleaned text that the
 * screen should show; it takes precedence over the raw `body`.
 */
export interface RenderQuoteInput {
  /** Raw message body (fallback when `displayBody` is absent). */
  body: string;
  /** Curated display text — preferred over `body` when present. */
  displayBody?: string | null;
  /** On-screen display name of the speaker (e.g. "מאור" | "מאורי"). */
  speaker: string;
  /** On-screen display name of the recipient. */
  recipient: string;
  /** When the message was sent (ISO string or Date). */
  sentAt: string | Date;
}

/** Minimal async mutex: serialises the lazy browser launch. */
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

/**
 * Get the shared Chromium instance, launching it once on first use. Concurrent
 * cold callers all await the same in-flight launch promise, so the browser is
 * never double-launched. If the cached browser has disconnected (crash), it is
 * transparently relaunched.
 */
async function getBrowser(): Promise<Browser> {
  if (browser !== null && browser.isConnected()) return browser;
  if (launching !== null) return launching;

  launching = chromium
    .launch({
      headless: true,
      // Hardened flags for the mis-api Docker container. --force-color-profile
      // pins sRGB so the grayscale→threshold step is deterministic across hosts.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--force-color-profile=srgb",
      ],
    })
    .then((b) => {
      browser = b;
      launching = null;
      // If Chromium dies, drop the cached handle so the next call relaunches.
      b.on("disconnected", () => {
        if (browser === b) browser = null;
      });
      return b;
    })
    .catch((err: unknown) => {
      launching = null;
      throw err;
    });

  return launching;
}

/** Resolve the text the screen should show: curated `displayBody` else `body`. */
function resolveBody(quote: RenderQuoteInput): string {
  const display = quote.displayBody;
  if (typeof display === "string" && display.trim().length > 0) return display;
  return quote.body;
}

/**
 * Render the keepsake HTML in the shared browser and capture an exact 800×480
 * PNG screenshot of the panel. The page is always closed, even on error.
 */
async function screenshotPanel(quote: RenderQuoteInput): Promise<Buffer> {
  const html = renderQuoteHtml({
    body: resolveBody(quote),
    speaker: quote.speaker,
    recipient: quote.recipient,
    sentAt: quote.sentAt,
  });

  const b = await getBrowser();
  const page: Page = await b.newPage({
    viewport: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
    deviceScaleFactor: 1, // 1 CSS px == 1 device px → exact 800×480 raster
  });
  try {
    await page.setViewportSize({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
    await page.setContent(html, { waitUntil: "networkidle" });
    // Ensure the keepsake fonts (Frank Ruhl Libre / Suez One / Heebo) are
    // loaded before we snapshot — per RENDER-CONTRACT. The callback runs in the
    // browser; `document` isn't in the server's TS `lib`, so we reach it through
    // `globalThis` with a narrow local type instead of `any`.
    await page.evaluate(async () => {
      const doc = (globalThis as { document?: { fonts: { ready: Promise<unknown> } } }).document;
      if (doc) await doc.fonts.ready;
    });
    const png = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT },
    });
    return png as Buffer;
  } finally {
    await page.close();
  }
}

/**
 * Render a quote to a 1-bit (pure black/white) PNG.
 *
 * Pipeline: keepsake HTML → Chromium screenshot → sharp grayscale → hard
 * threshold at 128 → single-channel PNG. The result contains only #000 and
 * #fff pixels, matching the RENDER-CONTRACT.
 *
 * @param quote Curated quote; `displayBody ?? body` is shown.
 * @returns A PNG `Buffer` (1 channel, thresholded black/white, 800×480).
 */
export async function renderQuotePng(quote: RenderQuoteInput): Promise<Buffer> {
  const screenshot = await screenshotPanel(quote);
  return sharp(screenshot)
    .grayscale()
    .threshold(THRESHOLD) // → pure 0/255 per pixel
    .toColourspace("b-w") // collapse to a single (grey) channel
    .png({ colours: 2, compressionLevel: 9 })
    .toBuffer();
}

/**
 * Render a quote to the RAW packed 1-bit framebuffer for the UC8179 panel.
 *
 * Returns exactly {@link EPD_BUFFER_BYTES} (48,000) bytes using the convention
 * documented at the top of this file: MSB-first, row-major, bit set (1) =
 * WHITE, bit clear (0) = BLACK. Hand this buffer straight to the panel's
 * full-frame write — no per-row padding, no header.
 *
 * @param quote Curated quote; `displayBody ?? body` is shown.
 * @returns A 48,000-byte `Buffer` (packed 1-bpp, white=1/black=0).
 */
export async function renderQuoteEpdBuffer(
  quote: RenderQuoteInput,
): Promise<Buffer> {
  const screenshot = await screenshotPanel(quote);

  // Get the thresholded pixels as raw single-channel grayscale: one byte per
  // pixel, value 0 (black) or 255 (white), row-major, no alpha.
  const { data, info } = await sharp(screenshot)
    .grayscale()
    .threshold(THRESHOLD)
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== PANEL_WIDTH || info.height !== PANEL_HEIGHT) {
    throw new Error(
      `render: unexpected raster ${info.width}x${info.height}, expected ${PANEL_WIDTH}x${PANEL_HEIGHT}`,
    );
  }
  if (info.channels !== 1) {
    throw new Error(
      `render: expected 1 channel after grayscale, got ${info.channels}`,
    );
  }

  // Pack 8 grayscale pixels per byte, MSB-first. Start fully WHITE (0xFF) and
  // clear a bit to 0 wherever the pixel is black.
  const out = Buffer.alloc(EPD_BUFFER_BYTES, 0xff);
  for (let y = 0; y < PANEL_HEIGHT; y++) {
    const srcRow = y * PANEL_WIDTH;
    const dstRow = y * BYTES_PER_ROW;
    for (let x = 0; x < PANEL_WIDTH; x++) {
      // thresholded: 0 = black, 255 = white. Only act on black pixels.
      if (data[srcRow + x] === 0) {
        const byteIndex = dstRow + (x >> 3);
        const bitMask = 0x80 >> (x & 7); // MSB-first within the byte
        out[byteIndex] &= ~bitMask; // clear bit → BLACK
      }
    }
  }
  return out;
}

/**
 * Gracefully close the shared Chromium browser (call on SIGINT/SIGTERM).
 * Safe to call when no browser was ever launched.
 */
export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  launching = null;
  if (b !== null && b.isConnected()) {
    await b.close();
  }
}
