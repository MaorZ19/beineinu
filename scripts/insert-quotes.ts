import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * Insert curated keepers into the `quotes` table as status='pending' for review.
 * Idempotent on message_source_line (re-running a keeper updates in place).
 *
 *   npx tsx scripts/insert-quotes.ts [path-to-keepers.json]
 *
 * Keeper shape: { sl, speaker, recipient, category, score, body, displayBody? }
 * `speaker`/`recipient` are already display names ("מאור" | "מאורי").
 */

interface Keeper {
  sl: number;
  speaker: string;
  recipient: string;
  category: string;
  score: number;
  body: string;
  displayBody?: string;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? ".tmp/keepers.json";
  const keepers: Keeper[] = JSON.parse(readFileSync(path, "utf8"));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 60_000,
    query_timeout: 60_000,
    max: 2,
  });

  let inserted = 0;
  for (const k of keepers) {
    // Pull the real sent_at from the source message so the date is authentic.
    const m = await pool.query(
      "select sent_at from messages where source_line = $1",
      [k.sl]
    );
    const sentAt: Date = m.rows[0]?.sent_at ?? new Date();

    await pool.query(
      `insert into quotes
         (message_source_line, body, display_body, speaker, recipient, score, category, sent_at, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       on conflict (message_source_line) do update set
         body = excluded.body,
         display_body = excluded.display_body,
         speaker = excluded.speaker,
         recipient = excluded.recipient,
         score = excluded.score,
         category = excluded.category,
         sent_at = excluded.sent_at`,
      [
        k.sl,
        k.body,
        k.displayBody ?? k.body,
        k.speaker,
        k.recipient,
        k.score,
        k.category,
        sentAt,
      ]
    );
    inserted++;
  }

  console.log(`Upserted ${inserted} quote(s) as status='pending'.`);
  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
