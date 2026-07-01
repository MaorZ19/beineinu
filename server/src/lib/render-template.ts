/**
 * Server-side render template for the e-paper keepsake card.
 *
 * Produces the locked "clean keepsake" design (see design/FINAL-design.html +
 * design/RENDER-CONTRACT.md) as a self-contained HTML string, populated with a
 * real quote. The renderer (render-png.ts) screenshots this at 800×480 and
 * thresholds it to 1-bit black/white for the panel.
 */

export interface QuoteForRender {
  body: string;
  speaker: string; // already a display name: "מאור" | "מאורי"
  recipient: string;
  sentAt: string | Date;
}

const HE_MONTHS = [
  "בינואר", "בפברואר", "במרץ", "באפריל", "במאי", "ביוני",
  "ביולי", "באוגוסט", "בספטמבר", "באוקטובר", "בנובמבר", "בדצמבר",
];

/** "19 במרץ 2021" from a Date/ISO string (uses the date's UTC parts). */
export function formatHebrewDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return `${d.getUTCDate()} ${HE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Map a raw chat sender to its on-screen display name. */
export function displayName(rawSender: string): string {
  if (rawSender.trim().startsWith("מאורי")) return "מאורי";
  return "מאור";
}

/**
 * Pick a quote font-size tier so long quotes still fit the card. Mirrors the
 * RENDER-CONTRACT tiers (50→42→34→28). Chromium auto-wraps; this only scales.
 */
function quoteFontSize(body: string): number {
  const n = body.length;
  if (n <= 70) return 50;
  if (n <= 130) return 42;
  if (n <= 220) return 34;
  return 28;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HEART_SVG =
  '<svg viewBox="0 0 32 30" aria-hidden="true"><path d="M16 27 C16 27 3 18.5 3 9.8 C3 5.4 6.4 2.5 10.2 2.5 C13 2.5 15.1 4.2 16 6.2 C16.9 4.2 19 2.5 21.8 2.5 C25.6 2.5 29 5.4 29 9.8 C29 18.5 16 27 16 27 Z" fill="none" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/></svg>';

export function renderQuoteHtml(q: QuoteForRender): string {
  const fontSize = quoteFontSize(q.body);
  const body = escapeHtml(q.body);
  const speaker = escapeHtml(q.speaker);
  const date = formatHebrewDate(q.sentAt);

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=Suez+One&family=Heebo:wght@400;500&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#fff; }
  .panel {
    width:800px; height:480px; background:#fff; color:#000; position:relative; overflow:hidden;
    font-family:'Heebo','Assistant','Arial Hebrew',sans-serif;
    -webkit-font-smoothing:none; text-rendering:geometricPrecision;
  }
  .frame { position:absolute; top:24px; left:24px; right:24px; bottom:24px; border:2px solid #000; }
  .quote-wrap { position:absolute; top:70px; left:86px; right:86px; bottom:132px; display:flex; align-items:center; justify-content:center; text-align:center; }
  .quote { font-family:'Frank Ruhl Libre','Heebo',serif; font-weight:700; font-size:${fontSize}px; line-height:1.42; max-width:620px; color:#000; }
  .quote .qm { font-family:'Frank Ruhl Libre',serif; font-weight:900; font-size:1.15em; line-height:0; vertical-align:-0.28em; }
  .quote .qm.open { margin-left:12px; } .quote .qm.close { margin-right:12px; }
  .sign { position:absolute; left:64px; bottom:50px; text-align:left; }
  .sign .who { font-family:'Suez One','Frank Ruhl Libre',serif; font-size:34px; font-weight:400; line-height:1.05; white-space:nowrap; display:flex; align-items:center; gap:12px; }
  .sign .heart { width:22px; height:20px; } .sign .heart svg { display:block; width:100%; height:100%; }
  .sign .date { margin-top:10px; font-family:'Heebo',sans-serif; font-size:19px; font-weight:400; letter-spacing:3px; color:#000; }
</style>
</head>
<body>
  <div class="panel">
    <div class="frame"></div>
    <div class="quote-wrap">
      <div class="quote"><span class="qm open">&#8221;</span>${body}<span class="qm close">&#8220;</span></div>
    </div>
    <div class="sign">
      <div class="who"><span class="name">${speaker}</span><span class="heart">${HEART_SVG}</span></div>
      <div class="date">${date}</div>
    </div>
  </div>
</body>
</html>`;
}
