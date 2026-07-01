import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Pool } from "pg";
import {
  renderQuotePng,
  renderQuoteEpdBuffer,
  closeBrowser,
} from "../server/src/render";

/**
 * Pre-render every APPROVED quote to a 1-bit PNG and a raw 48000-byte EPD
 * buffer, written to .tmp/rendered/. These get rsynced to the VPS where a tiny
 * Node server hands one out at random — no Chromium on the server.
 *
 *   npx tsx scripts/render-approved.ts
 *
 * Output:
 *   .tmp/rendered/<id>.epd   (48000 bytes, what the ESP32 draws)
 *   .tmp/rendered/<id>.png   (preview)
 *   .tmp/rendered/manifest.json  ([{id, category, speaker, sentAt}])
 */

const OUT = ".tmp/rendered";

interface Row {
  id: number;
  body: string;
  display_body: string | null;
  speaker: string;
  recipient: string;
  sent_at: Date;
  category: string;
}

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    max: 2,
  });

  const res = await pool.query<Row>(
    `select id, body, display_body, speaker, recipient, sent_at, category
       from quotes where status = 'approved' order by id`
  );
  await pool.end();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const manifest: Array<Record<string, unknown>> = [];
  let n = 0;
  for (const r of res.rows) {
    const q = {
      body: r.body,
      displayBody: r.display_body ?? r.body,
      speaker: r.speaker,
      recipient: r.recipient,
      sentAt: r.sent_at,
      category: r.category,
    };
    const epd = await renderQuoteEpdBuffer(q);
    const png = await renderQuotePng(q);
    if (epd.length !== 48000) {
      throw new Error(`Quote ${r.id} produced ${epd.length} EPD bytes (expected 48000).`);
    }
    writeFileSync(`${OUT}/${r.id}.epd`, epd);
    writeFileSync(`${OUT}/${r.id}.png`, png);
    manifest.push({
      id: r.id,
      category: r.category,
      speaker: r.speaker,
      sentAt: r.sent_at,
    });
    n++;
    if (n % 10 === 0) console.log(`rendered ${n}/${res.rowCount}`);
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await closeBrowser();
  console.log(`Done. Rendered ${n} approved quote(s) → ${OUT}/ (each .epd is 48000 bytes).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
