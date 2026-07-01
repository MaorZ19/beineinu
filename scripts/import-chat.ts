import { config as loadEnv } from "dotenv";
// Next.js precedence: .env.local overrides .env. Load both, local first.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseWhatsappExport, type ParsedMessage } from "../src/lib/whatsapp-parser";
import { getPool, closePool } from "../src/lib/db";

/**
 * Idempotent WhatsApp import into self-hosted Postgres.
 *
 * Parses the iPhone `_chat.txt` export and bulk-inserts couple-only messages
 * into `messages`. Re-running is safe: rows conflict on the stable
 * `source_line` unique key, so duplicates are overwritten in place.
 *
 *   npm run import:chat
 *
 * Env (loaded via dotenv: .env.local then .env):
 *   DATABASE_URL       postgres connection string (via SSH tunnel for local runs)
 *   CHAT_EXPORT_PATH   path to the export        (default "./_chat.txt")
 *   COUPLE_SENDER_A    first couple participant
 *   COUPLE_SENDER_B    second couple participant
 */

const DEFAULT_EXPORT_PATH = "./_chat.txt";
const BATCH_SIZE = 1000;

async function main(): Promise<void> {
  const exportPath = resolve(
    process.cwd(),
    process.env.CHAT_EXPORT_PATH ?? DEFAULT_EXPORT_PATH
  );
  const senderA = process.env.COUPLE_SENDER_A;
  const senderB = process.env.COUPLE_SENDER_B;

  if (!senderA || !senderB) {
    throw new Error(
      "Missing COUPLE_SENDER_A or COUPLE_SENDER_B in env — set both to the two couple participants."
    );
  }

  console.log(`Reading export: ${exportPath}`);
  const raw = readFileSync(exportPath, "utf8");

  console.log("Parsing…");
  const messages: ParsedMessage[] = parseWhatsappExport(raw, {
    coupleSenders: [senderA, senderB],
  });

  const total = messages.length;
  console.log(`Parsed ${total} couple message(s).`);

  if (total === 0) {
    console.warn("Nothing to import — check the export path and sender names.");
    return;
  }

  const pool = getPool();
  const sendersSeen = new Set<string>();
  let upserted = 0;
  let failedRows = 0;

  for (let start = 0; start < total; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, total);
    const slice = messages.slice(start, end);

    // Build a single multi-row INSERT ... ON CONFLICT for the batch.
    const values: unknown[] = [];
    const tuples: string[] = [];
    slice.forEach((m, i) => {
      const b = i * 4;
      tuples.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`);
      values.push(m.sourceLine, m.sender, m.body, m.sentAt.toISOString());
      sendersSeen.add(m.sender);
    });

    const sql =
      `INSERT INTO messages (source_line, sender, body, sent_at) VALUES ` +
      tuples.join(", ") +
      ` ON CONFLICT (source_line) DO UPDATE SET ` +
      `sender = EXCLUDED.sender, body = EXCLUDED.body, sent_at = EXCLUDED.sent_at`;

    try {
      await pool.query(sql, values);
      upserted += slice.length;
      console.log(`imported ${upserted} / ${total}`);
    } catch (err) {
      failedRows += slice.length;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `Batch failed for rows ${start}–${end - 1} (source_line ` +
          `${slice[0]?.sourceLine}–${slice[slice.length - 1]?.sourceLine}): ${message}`
      );
    }
  }

  console.log("");
  console.log("=== Import summary ===");
  console.log(`Total parsed:     ${total}`);
  console.log(`Total upserted:   ${upserted}`);
  if (failedRows > 0) console.log(`Failed (skipped): ${failedRows}`);
  console.log(
    `Distinct senders: ${sendersSeen.size} [${[...sendersSeen].join(", ")}]`
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Import failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
