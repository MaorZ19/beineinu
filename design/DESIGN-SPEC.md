# Maori Ink Screen — Final Design

**Winner:** framed-keepsake

> It is the only concept whose fully-realized, threshold-proofed render (keepsake-render2.png + the 1-bit proof) nails Maor's explicit emotional brief — a hand-made framed love note on the wall, not a chat screenshot — while keeping RTL flawless and every grey pixel non-load-bearing. The centered serif body and double-rule frame deliver the wedding-invitation / printed-keepsake warmth the others only partially reach, and the מאור ← מאורי שלי line makes the beloved's name the heaviest mass on the card, which is precisely what 'strengthen the bond' means in type. Modern-bubble is more 1-bit-bulletproof and editorial-poster is more original, but both retain a faint chat-app or magazine read that dilutes the intimate keepsake feel; two-voices is emotionally closest but its render was never actually produced (the on-disk file is a duplicate), so it carries unverified e-paper risk on its thin rules and lightest body weight. Framed-keepsake wins on verified evidence + tightest soul-to-pixel fit, with the only open risk being serif fragility at the two smallest text sizes — a cheap, isolated fallback (drop eyebrow + attribution to Heebo) fully de-risks it.

---

# Maori Ink Screen — Design Spec: "framed-keepsake" (FINAL)

A framed love-note keepsake card that fills the entire 800×480 e-paper panel. No chat-app chrome — a dated memory on the wall. This spec is deterministic: the Phase-3 server renderer can reproduce both reference files (`keepsake-final.html` short, `keepsake-final-long.html` long) pixel-for-pixel from data.

Verified: both references rendered via Playwright at **measured 800×480**, fonts loaded, no element overflow or collision, then hard-thresholded with PIL (`L.point(p>128)`) to pure 1-bit — **0 grey pixels**, ink coverage 6.65% (short) / 7.40% (long).

---

## 1. Canvas & coordinate system

| Property | Value |
|---|---|
| Panel | EXACTLY `800 × 480` px, landscape, no scroll, `overflow:hidden` |
| Direction | `dir="rtl"` on `<html>`, `lang="he"` |
| Colors | Pure `#000` on `#FFF` ONLY. No grey, gradient, soft shadow, or AA-dependent element |
| Font smoothing | `-webkit-font-smoothing:none; text-rendering:geometricPrecision` (crisp 1-bit edges) |
| Origin | Top-left `(0,0)`; all geometry below is absolute px from panel edges |

## 2. Frame / border motif (fixed, never data-driven)

- **Outer rule:** `3px` solid `#000`, inset `18px` on all sides.
- **Inner rule:** `1px` solid `#000`, inset `26px`. The two rules sit 8px apart = matted-frame look.
- **Corner ticks:** four `9px × 9px` solid-black squares at `22px` inset (tl/tr/bl/br) — keepsake flourish.

## 3. Type scale (px) & fonts

**Font stack:** quote + quote-mark = `'Frank Ruhl Libre', 'Heebo', serif` (weights 500/700/900). Everything else = `'Heebo', 'Assistant', 'Arial Hebrew', sans-serif` (weights 400/500/700/900). Load both via Google Fonts `@import` (or self-host the two families for offline render — **renderer must wait for `document.fonts.ready` before snapshot**).

| Element | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Quote-mark ornament `"` | Frank Ruhl Libre | `118px` (short) / `104px` (4-line-risk) | 900 | Absolute, `top:44px/36px; right:150px`, `line-height:.7`, `pointer-events:none` |
| **Quote (hero)** | Frank Ruhl Libre | **tiered: 46 / 36→auto / 28** | 700 | See §5 auto-fit |
| Recipient name (TO) | Heebo | `30px` | **900** | Heaviest mass on card = beloved's name |
| Speaker name (FROM) | Heebo | `30px` | 700 | — |
| Speaker chip `מ` | Heebo | `24px` | 900 | Inside 44px outline circle |
| Role labels `מאת` / `אל` | Heebo | `18px` | 500 | letter-spacing 4px |
| Category tag | Heebo | `22px` | 700 | letter-spacing 3px, boxed |
| Footer date | Heebo | `24px` | 500 | letter-spacing 2px |

Minimums honored: hero never below `28px`; smallest text (role labels) `18px` is a tracked, low-information label — if real-panel testing shows it fading, bump to `20px` (there is vertical room).

## 4. Layout regions (absolute)

```
y=40   Category tag (boxed)         right:46px   ─┐ top band
y=44   Quote-mark ornament          right:150px  ─┘
y=100→384  .content (centered flex box)           ← hero quote + divider + attribution
           top:100 / 104, bottom:96 / 90, padding:0 70px
y=405  Footer signature line        bottom:40/34, left/right:60px
```

- `.content` is a vertically-centered flex column **bounded between the top band (≈100px) and the footer (≈96px from bottom)** — this is the single most important rule: the quote auto-centers inside this safe box and can NEVER collide with the category/quote-mark or the dated footer, at any tier.
- **Divider** between quote and attribution: two `70px × 2px` black rules flanking a `10px` rotated-square diamond. Margins `26/20` (short), `22/16` (long).

## 5. Quote auto-fit (deterministic algorithm)

Renderer measures with real font metrics (headless browser / same engine), then:

1. **Tier by character count** to pick a START size:
   - `len ≤ 90`  → `46px`, line-height `1.34`, max-width `630px`
   - `len ≤ 160` → `36px`, line-height `1.34`, max-width `660px`
   - `len > 160` → `28px` (floor), line-height `1.4`, max-width `680px`
2. **Fit loop (the hard rule):** measure rendered line count. While the quote wraps to **> 3 lines**, step font size DOWN by `2px` (and nudge line-height toward `1.3`) until it fits in **≤ 3 lines OR hits the 28px floor**. (Example: the 132-char long sample starts at 36px → wraps to 4 lines → steps to 34 (still 4) → **32px gives 3 lines**; 32 > 28 floor, so legibility is uncompromised. This is exactly what `keepsake-final-long.html` encodes.)
3. If still > 3 lines at the 28px floor (extremely long quote), the source data should be flagged for trimming — 3 lines @ 28px is the legibility/whitespace contract for this panel. Do NOT go below 28px for the hero.

The reference short file is the 2-line/46px case; the reference long file is the 3-line/32px case.

## 6. RTL + speaker-side handling

- Panel is `dir="rtl"`; Hebrew shapes and punctuation/commas mirror natively. The ONLY direction-neutral element is the arrow (inline SVG, drawn pointing left).
- **Attribution is a 3-column CSS grid** (`grid-template-columns: auto 56px auto`) shared by TWO rows via `display:contents` on the wrappers, so labels sit exactly over their columns:
  - **Row 1 (role labels):** `מאת` (right col) · gap · `אל` (left col)
  - **Row 2 (names):** `[chip מ][מאור]` FROM (right col) · `←` arrow (middle) · `מאורי שלי` recipient (left col)
- Because of RTL, the FIRST DOM/grid item lands on the RIGHT. Reading order travels **right→left = FROM Maor → TO Maori**. Verified: FROM-cluster center x≈518, recipient center x≈294 (`fromIsRightOfRecipient:true`), labels centered 0px-offset over their columns, recipient never wraps (`white-space:nowrap`).
- **Speaker chip** (redundant who-spoke encoding, grafted from modern-bubble): `44×44` circle, `2.4px` outline, initial letter of speaker, weight 900. Always = first letter of the FROM name.

## 7. Heart / ornament motif (all true 1-bit, fill:none strokes)

| Heart | Size | Stroke | Where |
|---|---|---|---|
| Inline quote heart (replaces 💛) | `34×34` (short) / `28×28` (long) | `2.4px` | End of quote text, `vertical-align` baseline |
| Footer hearts ×2 | `20×18` | `2.6px` | Flanking the date |

All hearts are inline `<svg viewBox>` with `fill:none; stroke:#000; stroke-linejoin:round`. Arrow = SVG `line` + `polyline`, `2.6px` stroke. Diamond/ticks/rules are the only solid-black fills (large enough to survive threshold).

## 8. Category tag (grafted from editorial-poster)

Boxed label top-right, `2px` border, padding `3px 18px 5px`. Value = one of the four Maor-named registers, set from data:
`חיבה` (affection) · `משפחה` (family) · `מצחיק` (funny) · `מרגש` (meaningful). Sets the emotional register before reading.

## 9. Footer signature line (grafted from two-voices)

Centered dated stamp: `[rule ───] ♡ [date] ♡ [rule ───]`, rules `flex:1` running to 60px margins. Date is free Hebrew text (e.g. `19 במרץ 2021`, `2 בנובמבר 2023`), `white-space:nowrap`. Stamps each quote as a real dated moment.

## 10. Strict 1-bit rules

- Every pixel must survive `luminance > 128 ? white : black`. No element may rely on grey/AA to be readable.
- Solid-black fills only for shapes ≥ ~9px (ticks, diamond, rules); all fine ornaments are outline strokes ≥ 2.4px.
- Render at `deviceScaleFactor: 1` (no retina upscaling — the panel is 1×).
- After render, run the threshold and assert `grey_px == 0` and `size == (800,480)` as a CI gate.

---

## RENDER CONTRACT (must hold for every generated card)

1. Output is EXACTLY `800×480` px, 1-bit, pure `#000`/`#FFF`, zero grey after threshold.
2. Wait for `document.fonts.ready` before snapshot; both font families present or render fails (no silent fallback to system serif that breaks metrics).
3. Hero quote fits in `≤ 3` visual lines via the tier+step-down algorithm; never smaller than `28px`.
4. Frame, ticks, divider, footer rules, category box, and quote-mark are at fixed coordinates — only quote text, quote font-size, category value, speaker/recipient names, chip initial, and date are data-driven.
5. Attribution always reads RTL right→left FROM→TO; recipient is weight 900 (heaviest); recipient never wraps.
6. No element collides with the frame, the top band, or the footer (content stays inside the `top:100 / bottom:96` safe box).