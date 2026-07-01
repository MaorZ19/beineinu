# Maori Ink Screen — Firmware (XIAO ESP32-C3 + Seeed 7.5" e-paper)

Confirmed hardware (read from your connected board via esptool):
**XIAO ESP32-C3**, 4MB flash, no PSRAM. Panel: Seeed 7.5" 800×480, UC8179 controller.

The board does almost nothing clever: every wake it pulls a fully-rendered 1-bit
image from the VPS and blits it. All the Hebrew/RTL/layout work happens server-side.

## 1. One-time Arduino IDE setup

1. Install the **Arduino IDE** (2.x).
2. **Boards**: Preferences → Additional Boards Manager URLs, add
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then Tools → Board → Boards Manager → install **esp32 by Espressif**.
3. Tools → **Board** → `XIAO_ESP32C3`.
4. **Library**: Library Manager → install **Seeed_GFX** (this is the Seeed fork of
   TFT_eSPI with the UC8179 7.5" e-paper driver). Do NOT also have plain TFT_eSPI
   installed — they conflict.
5. **Select the e-paper User_Setup**: Seeed_GFX picks its panel via a User_Setup
   header. Use the **"Seeed XIAO 7.5 inch ePaper (UC8179)"** setup
   (`Setup502_Seeed_XIAO_EPaper_7inch5.h` in the library's `User_Setups/`), enabled
   in the library's `User_Setup_Select.h`. (Same setup the `hebrew-time` project uses.)

## 2. Configure & flash

1. Open `firmware/MaoriInkScreen/MaoriInkScreen.ino`.
2. Edit `config.h`:
   - `WIFI_SSID` / `WIFI_PASSWORD`
   - `QUOTE_EPD_URL` — point it at your server’s `/quote/random.epd` endpoint; for
     a quick local test set `USE_HTTPS 0` and point at a plain-HTTP host.
   - `SLEEP_SECONDS` — how often the quote changes (default 12 min).
3. Plug the board in (it shows up as `/dev/cu.usbmodem*`), select that Port.
4. **Upload**. If upload fails to start, hold **BOOT**, tap **RESET**, release BOOT,
   then upload (rarely needed on C3 native-USB).
5. Open Serial Monitor @ 115200 to watch: WiFi → fetch → draw → sleep.

## 3. The image format (server ↔ firmware contract)

`GET /quote/random.epd` returns exactly **48000 bytes**:
- 800×480 = 384000 px, 1 bit/px, MSB-first, row-major.
- **bit = 1 → WHITE, bit = 0 → BLACK.**

The firmware reads those bytes straight into `frame[48000]` and draws them. If the
image ever comes out inverted, flip the fg/bg in `drawFrame()` (or flip the server's
threshold polarity) — they must agree on the convention above.

## 4. Power

e-paper holds the image with **zero power** during deep sleep, so battery life is
dominated by the brief Wi-Fi+fetch burst each wake. Longer `SLEEP_SECONDS` = longer
battery. For a wall unit on USB power, any cadence is fine.

## Troubleshooting

- **Blank/garbled panel**: wrong User_Setup selected, or fg/bg inverted — see §3.
- **Hebrew looks wrong**: it can't — the panel never renders text, it draws a finished
  image. Any text issue is server-side (the render contract).
- **Won't connect**: check 2.4GHz Wi-Fi (ESP32-C3 has no 5GHz).
- **Short read in Serial**: the server returned the wrong byte count — verify
  `/quote/random.epd` returns exactly 48000 bytes (`curl -s URL | wc -c`).
