import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { Pool } from "pg";

/**
 * Tiny CLI to review and approve/reject pending quotes from the terminal.
 *
 *   npx tsx scripts/review-quotes.ts list                 # show pending (highest score first)
 *   npx tsx scripts/review-quotes.ts approve <id> [<id>…] # approve by id
 *   npx tsx scripts/review-quotes.ts reject  <id> [<id>…]
 *   npx tsx scripts/review-quotes.ts approve-all          # approve every pending
 *   npx tsx scripts/review-quotes.ts approve-min <score>  # approve all pending with score >= N
 *
 * Connects through the SSH tunnel (DATABASE_URL on 127.0.0.1:55432).
 */

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    max: 2,
  });

  const setStatus = async (ids: number[], status: string) => {
    const res = await pool.query(
      `update quotes set status = $1, reviewed_at = now() where id = any($2::bigint[])`,
      [status, ids]
    );
    console.log(`${status}: ${res.rowCount} quote(s).`);
  };

  if (cmd === "list" || !cmd) {
    const res = await pool.query(
      `select id, score, category, speaker, recipient, coalesce(display_body, body) as text, sent_at::date as d
       from quotes where status = 'pending' order by score desc`
    );
    for (const r of res.rows) {
      const text = String(r.text).replace(/\n/g, " ");
      console.log(
        `#${r.id}  [${r.score}] ${r.category}  ${r.speaker}→${r.recipient}  (${r.d})\n   ${text}\n`
      );
    }
    console.log(`${res.rowCount} pending.`);
  } else if (cmd === "approve" || cmd === "reject") {
    const ids = rest.map(Number).filter((n) => Number.isInteger(n));
    if (!ids.length) {
      console.error("Provide quote id(s).");
      process.exitCode = 1;
    } else {
      await setStatus(ids, cmd === "approve" ? "approved" : "rejected");
    }
  } else if (cmd === "approve-all") {
    const res = await pool.query(
      `update quotes set status='approved', reviewed_at=now() where status='pending'`
    );
    console.log(`approved: ${res.rowCount} quote(s).`);
  } else if (cmd === "approve-min") {
    const min = Number(rest[0]);
    const res = await pool.query(
      `update quotes set status='approved', reviewed_at=now() where status='pending' and score >= $1`,
      [min]
    );
    console.log(`approved (score>=${min}): ${res.rowCount} quote(s).`);
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
