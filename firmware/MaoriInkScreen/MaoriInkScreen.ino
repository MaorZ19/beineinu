// ===========================================================================
// Maori Ink Screen — XIAO ESP32 (C3/S3) + Seeed 7.5" e-paper (UC8179, 800x480)
//
// Each wake: connect Wi-Fi → fetch a freshly-rendered 1-bit buffer from the VPS
// (the server does ALL the layout/Hebrew/RTL work) → draw it → deep sleep.
// The panel keeps the image with zero power while asleep.
//
// Buffer convention (MUST match the server's /quote/random.epd):
//   800*480 = 384000 px = 48000 bytes, 1 bit per pixel, MSB-first, row-major.
//   bit = 1  → WHITE
//   bit = 0  → BLACK
// (This is the standard full-frame buffer Seeed_GFX/UC8179 consumes.)
//
// Library: Seeed_GFX (NOT GxEPD2). Install via Arduino Library Manager, and use
// the User_Setup for "Seeed XIAO 7.5 inch ePaper" (UC8179). See README.md.
// ===========================================================================

#include "config.h"
#include <WiFi.h>

#if USE_HTTPS
  #include <WiFiClientSecure.h>
  #include <HTTPClient.h>
#else
  #include <HTTPClient.h>
#endif

// Seeed_GFX e-paper driver. The 7.5" UC8179 panel is selected by Setup502,
// which must be enabled in the library's User_Setup_Select.h (the installer
// step does this). That setup defines EPAPER_ENABLE + UC8179_DRIVER + 800x480.
#include <TFT_eSPI.h>
EPaper epaper;   // EPaper extends TFT_eSprite — it IS a full-frame buffer.

// 48000-byte frame buffer fetched from the server. Fits in the C3's ~400KB SRAM.
static uint8_t frame[EPD_BYTES];

// ---------------------------------------------------------------------------
static bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

// Fetch exactly EPD_BYTES into `frame`. Returns true on a complete read.
static bool fetchFrame() {
  HTTPClient http;
  bool ok = false;

#if USE_HTTPS
  WiFiClientSecure client;
  // Let's Encrypt cert: for simplicity we skip CA pinning. The payload is a
  // public, non-sensitive image buffer, so this is acceptable here.
  client.setInsecure();
  if (!http.begin(client, QUOTE_EPD_URL)) return false;
#else
  if (!http.begin(QUOTE_EPD_URL)) return false;
#endif

  http.setTimeout(HTTP_TIMEOUT_MS);
  int code = http.GET();
  if (code == HTTP_CODE_OK) {
    int len = http.getSize();           // expect EPD_BYTES (or -1 if chunked)
    WiFiClient *stream = http.getStreamPtr();
    size_t got = 0;
    uint32_t start = millis();
    while (got < EPD_BYTES && millis() - start < HTTP_TIMEOUT_MS) {
      size_t avail = stream->available();
      if (avail) {
        size_t want = EPD_BYTES - got;
        if (avail > want) avail = want;
        int r = stream->readBytes(frame + got, avail);
        if (r > 0) { got += r; start = millis(); }
      } else if (!stream->connected()) {
        break;
      } else {
        delay(5);
      }
    }
    ok = (got == EPD_BYTES);
    // Debug: report bytes read + a sanity sample so we can see the buffer.
    Serial.printf("fetch: got %u / %u bytes (len=%d) ok=%d\n",
                  (unsigned)got, (unsigned)EPD_BYTES, len, ok);
    Serial.printf("first bytes: %02X %02X %02X  byte[100]=%02X\n",
                  frame[0], frame[1], frame[2], frame[100]);
  } else {
    Serial.printf("HTTP GET failed: %d\n", code);
  }
  http.end();
  return ok;
}

// Push the raw 1-bit buffer to the panel with a clean full refresh.
//
// Server convention: 1 bit/px, MSB-first, row-major, 100 bytes/row,
// bit = 1 → WHITE, bit = 0 → BLACK.
//
// We write each pixel explicitly with drawPixel (the same approach the proven
// hebrew-time firmware uses for this panel) instead of drawBitmap — Seeed_GFX's
// 1-bit sprite has its own internal stride, and drawBitmap's packing did not
// match our 100-bytes/row buffer, which shifted/clipped the image. Looping by
// pixel is immune to that. We only need to paint BLACK pixels because the
// sprite is pre-filled white.
static void drawFrame() {
  // Diagnostic: the sprite MUST be 800x480x1. If width != 800 the wrong
  // User_Setup was compiled in and the image will shear/clip.
  Serial.printf("sprite w=%d h=%d bpp=%d\n",
                epaper.width(), epaper.height(), epaper.getColorDepth());

  // Mirror the proven PanelTest sequence exactly: explicitly clear the sprite
  // to WHITE first (do NOT assume it is pre-filled), then paint only the BLACK
  // pixels from the buffer, then a single full update(). WiFi is already OFF
  // by the time we get here (see setup()), so the SPI push to the panel is not
  // contended by the radio — the one difference that made PanelTest render and
  // this go solid black.
  epaper.fillScreen(TFT_WHITE);

  // Draw pixel-by-pixel — the exact approach the proven hebrew-time firmware
  // uses on this panel (immune to any pushImage stride interpretation).
  // Server convention: 1 bit/px, MSB-first, 100 B/row, bit=1 WHITE / bit=0 BLACK.
  long blackCount = 0;
  for (int y = 0; y < EPD_HEIGHT; y++) {
    const int rowByte = y * (EPD_WIDTH / 8);
    for (int x = 0; x < EPD_WIDTH; x++) {
      const uint8_t byte = frame[rowByte + (x >> 3)];
      // Buffer: bit=1 WHITE, bit=0 BLACK → paint black where bit==0.
      if (((byte >> (7 - (x & 7))) & 1) == 0) {
        epaper.drawPixel(x, y, TFT_BLACK);
        blackCount++;
      }
    }
  }
  Serial.printf("painted %ld black px (expect a few thousand). "
                "If ~384000 the buffer is empty/zero; if 0 it is all-white.\n",
                blackCount);
  epaper.update();   // single full refresh (no ghosting)
  Serial.println("drew real quote frame");
}

static void sleepNow() {
  // Wi-Fi was already turned off in setup() before drawing; this is a no-op
  // safety net in case we reach sleep on a path that left it on.
  WiFi.mode(WIFI_OFF);
#ifdef DIAG_DELAY_SECONDS
  // Diagnostic: stay awake (USB-CDC alive) so serial output is readable and the
  // board can be re-flashed without the BOOT dance. Remove for production.
  Serial.printf("DIAG: staying awake %d s before sleep...\n", DIAG_DELAY_SECONDS);
  for (int i = 0; i < DIAG_DELAY_SECONDS; i++) { Serial.print('.'); delay(1000); }
  Serial.println();
#endif
  Serial.printf("Sleeping %lu s\n", (unsigned long)SLEEP_SECONDS);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_SECONDS * 1000000ULL);
  esp_deep_sleep_start();
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100);

  epaper.begin();          // Seeed_GFX EPaper init
  epaper.setRotation(0);   // 800x480 landscape

  if (connectWifi()) {
    bool haveFrame = fetchFrame();
    // CRITICAL: turn the radio fully OFF before touching the panel. On the
    // single-core C3 an active Wi-Fi stack contends with the SPI push and
    // corrupts the e-paper refresh (the symptom: a solid-black panel even
    // though the buffer is correct). PanelTest renders perfectly precisely
    // because it never brings Wi-Fi up. So: fetch first, kill the radio, draw.
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(50);
    if (haveFrame) {
      drawFrame();
      Serial.println("Drew new quote.");
    } else {
      Serial.println("Fetch failed — leaving previous image.");
    }
  } else {
    WiFi.mode(WIFI_OFF);
    Serial.println("WiFi failed — leaving previous image.");
  }

  sleepNow();
}

void loop() {
  // unreachable — deep sleep restarts from setup()
}
