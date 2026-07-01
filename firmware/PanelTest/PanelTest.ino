// Panel test pattern — no WiFi, no fetch. Draws known geometry so we can read
// the panel's true orientation + polarity directly.
#include <TFT_eSPI.h>
EPaper epaper;

void setup() {
  Serial.begin(115200);
  delay(200);
  epaper.begin();
  epaper.setRotation(0);
  Serial.printf("w=%d h=%d bpp=%d\n", epaper.width(), epaper.height(), epaper.getColorDepth());

  epaper.fillScreen(TFT_WHITE);                       // expect WHITE background
  // thick black border (10px) — reveals edges/clipping
  epaper.fillRect(0, 0, 800, 10, TFT_BLACK);          // top
  epaper.fillRect(0, 470, 800, 10, TFT_BLACK);        // bottom
  epaper.fillRect(0, 0, 10, 480, TFT_BLACK);          // left
  epaper.fillRect(790, 0, 10, 480, TFT_BLACK);        // right
  // big black box in the TOP-LEFT quadrant — reveals orientation
  epaper.fillRect(40, 40, 300, 180, TFT_BLACK);
  // diagonal of black dots from top-left toward bottom-right — reveals shear
  for (int i = 0; i < 480; i++) epaper.drawPixel(i, i, TFT_BLACK);
  // label
  epaper.setTextColor(TFT_BLACK);
  epaper.drawString("TOP-LEFT BOX", 360, 100, 4);
  epaper.update();
  Serial.println("drew test pattern");
}
void loop() {
  delay(1000);
  Serial.print('.');  // stay awake & reachable (no deep sleep) for easy reflash
}
