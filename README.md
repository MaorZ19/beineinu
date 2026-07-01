# Maori Ink Screen 💛

<!-- photo: e-paper frame on the wall showing a rendered quote card — add yours here -->

**A love letter that rewrites itself every 12 minutes.**

I built this for my wife, Maori. We've been texting each other on WhatsApp for
years — hundreds of thousands of messages — and buried inside all that logistics
noise are the lines that actually matter: the tender ones, the ones that made us
laugh out loud, the little notes about our kid. So I exported the whole chat,
taught an AI to find the beautiful moments, and put them on a battery-powered
e-paper frame on our wall. Every few minutes it wakes up, picks a random memory,
draws it as a clean literary keepsake card in Hebrew, and goes back to sleep.

Technically, it's a deliberately "dumb screen, smart server" system: a Postgres
database of real messages, an AI curation pass, a locked HTML design rendered to
1-bit 800×480 frames with headless Chromium, and a XIAO ESP32-C3 that just
fetches 48,000 bytes and blits them to a 7.5" e-paper panel. All the hard parts
(Hebrew, RTL, typography, curation) happen server-side. Everything is
self-hosted — your chat history never touches anyone else's cloud.

## Features

- **WhatsApp export parser** — handles the iPhone `_chat.txt` format: RTL control
  marks, multi-line messages, media/system-line stripping, emoji display names.
- **AI curation pipeline** — a high-signal candidate pool (keyword + length
  heuristics over the full history) feeds an AI scorer; you approve/reject with a
  small CLI. Categories: affection / family / funny / meaningful.
- **Locked keepsake design** — a framed literary quote card (Frank Ruhl Libre +
  Suez One + Heebo), auto-fitting font tiers, verified to survive a hard 1-bit
  threshold with zero grey pixels. Full spec in `design/`.
- **Pre-rendered frames** — Playwright screenshots the template at exactly
  800×480 and packs it to a raw 48,000-byte EPD buffer + preview PNG.
- **Family photos in the rotation** — dithered photos (Floyd–Steinberg, Atkinson,
  halftone) are byte-compatible with quote frames and mix in automatically.
- **Tiny serve API** — a dependency-free Node server that hands out a random
  pre-rendered frame. No Chromium, no database on the hot path.
- **Deep-sleep firmware** — the ESP32-C3 wakes on a timer, fetches one frame over
  HTTPS, draws it, and sleeps. E-paper holds the image at zero power.

## Architecture

```
WhatsApp _chat.txt ─ parser ─▶ Postgres (messages)               [your VPS, localhost-only]
                                   │
                          AI curation ─▶ quotes (approved)
                                   │
              render locally (Playwright → 800×480 1-bit) ─▶ .epd + .png
                                   │ rsync
                                   ▼
        serve API (node:20-alpine on VPS) ── nginx + Let's Encrypt TLS
                                   │  GET /quote/random.epd (48000 bytes)
                                   ▼
                 XIAO ESP32-C3 ─ draws frame ─ deep sleep   [Seeed 7.5", UC8179]
```

The screen is "dumb": the server does all layout/Hebrew/RTL/curation; the device
just fetches a finished buffer.

## Hardware

| Part | Notes |
|------|-------|
| [Seeed Studio 7.5" e-paper panel](https://www.seeedstudio.com/) | 800×480, black/white, **UC8179** controller |
| Seeed XIAO **ESP32-C3** | 4MB flash, no PSRAM needed — the 48KB frame fits in SRAM |
| XIAO e-paper driver board | connects the panel to the XIAO over SPI |
| Any USB-C supply or LiPo battery | e-paper draws zero power between wakes |
| A picture frame | the part your partner actually sees |

## Quickstart

1. **Export your chat.** WhatsApp → chat → Export Chat → *Without Media*. Put the
   `_chat.txt` file in the project root.

2. **Stand up Postgres + the API** (self-hosted, Docker):
   ```bash
   cp .env.example .env.local          # root scripts config
   cp server/.env.example server/.env  # API container config
   docker compose -f server/docker-compose.yml up -d --build
   ```
   Apply the migrations in `db/migrations/` (in order) to create the
   `messages` and `quotes` tables.

3. **Import the history** (idempotent — safe to re-run):
   ```bash
   npm install
   npx tsx scripts/import-chat.ts
   ```

4. **Curate.** Build a candidate pool, score it with your favorite LLM, insert
   the keepers, then approve:
   ```bash
   npx tsx scripts/fetch-candidates.ts --limit 2000
   # → curate .tmp/candidates.json into .tmp/keepers.json (AI or by hand)
   npx tsx scripts/insert-quotes.ts
   npx tsx scripts/review-quotes.ts list
   npx tsx scripts/review-quotes.ts approve-all   # or approve/reject by id
   ```

5. **Render the frames** and sync them to your server:
   ```bash
   npx tsx scripts/render-approved.ts
   rsync -az --delete .tmp/rendered/ root@your-vps:/opt/maori-serve/rendered/
   curl -s https://maori.your-vps.example.com/healthz   # {ok:true, count:N}
   ```
   `serve/server.mjs` (see `server/README.md` for deploy details) hands out a
   random frame at `GET /quote/random.epd`.

6. **Flash the firmware.** Copy `firmware/MaoriInkScreen/config.h.example` to
   `config.h`, set your Wi-Fi credentials and `QUOTE_EPD_URL`, and follow
   **[firmware/README.md](firmware/README.md)** for the Arduino IDE setup
   (Seeed_GFX library, UC8179 User_Setup, flashing recipe). Start with
   `firmware/PanelTest/` if you want to prove the panel wiring first.

## Adding family photos

The screen draws any 48,000-byte 1-bit frame in the pool at random — a dithered
photo is just another frame, so photos mix in with the quotes with no firmware
or server change.

1. **Compare dithering styles** for a photo (writes previews to `.tmp/photo-samples/`):
   ```bash
   npx tsx scripts/photo-to-epd.ts samples ./photo-1.jpg
   ```
   Styles: `floyd-steinberg` (soft/photographic — the default), `atkinson`
   (crisp/high-contrast), `halftone` (pop-art dots).
2. **Frame the face.** Auto-crop chases contrast, not faces — pass an explicit
   `--rect x,y,w,h` (pixels after EXIF rotation). Tone flags:
   `--brightness --contrast --gamma`.
3. **Commit one style** into the live pool:
   ```bash
   npx tsx scripts/photo-to-epd.ts add ./photo-1.jpg --style floyd-steinberg --rect X,Y,W,H
   ```
4. rsync `.tmp/rendered/` to your server — the wall picks it up on the next wake.

## Privacy

Everything here is self-hosted: the chat export, the database, the curation
output, and the rendered frames all live on machines **you** control. Postgres
binds to localhost only; the public endpoint serves finished image frames and
nothing else. Your data never leaves your server.

For the same reason, this repo ships **no real data** — no chat exports, no
rendered frames, no photos. You bring your own love story.

## Want one without the soldering?

I'm turning this into a small product — a ready-made frame preloaded with *your*
moments. Join the waitlist at **[ink.jango-ai.com](https://ink.jango-ai.com)**.

## License

[MIT](LICENSE) — build one for someone you love.
