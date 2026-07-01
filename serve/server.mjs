// Maori Ink Screen — lightweight serve API (no Chromium, pure Node).
//
// Serves pre-rendered quote frames from a directory. The heavy Playwright
// rendering happens offline on a dev machine; this just hands one out.
//
//   QUOTES_DIR=/data/rendered PORT=8080 node server.mjs
//
// Routes:
//   GET /healthz            → { ok, count }
//   GET /quote/random.epd   → a random 48000-byte raw e-paper buffer (the ESP32 draws this)
//   GET /quote/random.png   → the matching 1-bit PNG (for humans/preview)
//   GET /quote/:id.epd|.png → a specific frame by id

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const DIR = process.env.QUOTES_DIR || "./rendered";
const PORT = Number(process.env.PORT || 8080);

async function epdIds() {
  const files = await readdir(DIR);
  return files.filter((f) => f.endsWith(".epd")).map((f) => f.slice(0, -4));
}

function send(res, status, body, type = "application/json") {
  // Set Content-Length explicitly so the response is NOT chunked. The ESP32
  // reads the body as a raw byte stream; chunked transfer-encoding would
  // interleave hex chunk-size headers into the buffer (corrupting the first
  // bytes), since the firmware's manual stream read does not de-chunk.
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    if (path === "/healthz") {
      const ids = await epdIds();
      return send(res, 200, JSON.stringify({ ok: true, count: ids.length }));
    }

    // /quote/random.(epd|png)  or  /quote/<id>.(epd|png)
    const m = path.match(/^\/quote\/([^/.]+)\.(epd|png)$/);
    if (m) {
      const [, name, ext] = m;
      let id = name;
      if (name === "random") {
        const ids = await epdIds();
        if (ids.length === 0) return send(res, 404, JSON.stringify({ error: "no quotes" }));
        id = ids[Math.floor(Math.random() * ids.length)];
      }
      const file = join(DIR, `${id}.${ext}`);
      const buf = await readFile(file).catch(() => null);
      if (!buf) return send(res, 404, JSON.stringify({ error: "not found" }));
      const type = ext === "png" ? "image/png" : "application/octet-stream";
      return send(res, 200, buf, type);
    }

    return send(res, 404, JSON.stringify({ error: "not found" }));
  } catch (err) {
    return send(res, 500, JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mis-serve listening on :${PORT}, quotes dir = ${DIR}`);
});
