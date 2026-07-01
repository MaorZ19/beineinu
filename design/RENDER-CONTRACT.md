# Maori Ink Screen — Locked Render Contract (Phase 3)

The Phase-3 PNG renderer MUST reproduce `design/FINAL-design.html` exactly.

## Canvas
- EXACTLY 800×480 px, landscape, `overflow:hidden`, no scroll.
- Pure #000 on #FFF. 1-bit black/white only. No grey/gradient/soft-shadow.
- `-webkit-font-smoothing:none; text-rendering:geometricPrecision`.
- Renderer MUST `await document.fonts.ready` before snapshot (Playwright/satori).

## Fonts (Google Fonts)
- Quote: **Frank Ruhl Libre** (700; quotation marks 900).
- Signature name: **Suez One** (400).
- Date: **Heebo** (400).

## Layout (locked)
- Single thin frame: 2px solid #000, inset 24px.
- Quote: centered, NO niqqud (authentic chat text), wrapped in opening ” (right)
  + closing “ (left) quotation glyphs. Base size 50px / line-height 1.42 /
  max-width 620px; renderer AUTO-FITS down for long quotes (tiers ~50→40→32, never <28px).
- Signature bottom-LEFT: name in Suez One 34px + one small outline heart; date below in Heebo 19px.
- NO category label. NO right-side rule. Exactly ONE small heart.

## Speaker display-name mapping (data → screen)
- raw sender "Maor"        → "מאור"
- raw sender "מאורי שלי❤️"  → "מאורי"

## Date format
- Hebrew: "<day> ב<month-he> <year>" e.g. "19 במרץ 2021".
