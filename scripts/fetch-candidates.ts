import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { writeFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * Build a high-signal CANDIDATE POOL from the 340K messages so the AI curator
 * only ever looks at messages that could plausibly be lovely — never the
 * "ok"/"מתי אתה מגיע" logistics noise (which is the vast majority).
 *
 * A message qualifies if EITHER:
 *   (a) it carries an affection / parenthood signal keyword (any length >= 15), OR
 *   (b) it is substantial (>= 60 chars) — long enough to hold a real sentiment.
 *
 * Output: a JSON file of candidates (default .tmp/candidates.json), each with
 * the surrounding 1-message context on each side so the curator can judge tone.
 *
 *   npx tsx scripts/fetch-candidates.ts [--limit N] [--out path]
 */

interface Candidate {
  sourceLine: number;
  sender: string;
  body: string;
  sentAt: string;
  prevSender: string | null;
  prevBody: string | null;
  nextBody: string | null;
}

// Affection / parenthood / humor signal. Kept deliberately broad — the AI does
// the real judging; this just avoids scanning 200K "ok"s. Add your own names
// (kids, pet names) to sharpen the pool for your chat.
const SIGNAL_REGEX =
  "אוהב|אוהבת|מתגעגע|מתגעגעת|חיים שלי|מלך שלי|מלכה שלי|אהובה|אהוב שלי|" +
  "מאוהב|יקירה|יקירי|נסיכה|תודה לך|גאה בך|המון אהבה|נשיקות|חיבוק|" +
  "אבא|אמא|הבן שלנו|הבת שלנו|מצחיק|צחקתי|מתה עליך|מת עליך|הכי טוב|הכי טובה";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 4000;
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : ".tmp/candidates.json";

  // Dedicated pool with a generous timeout — the windowed scan over 340K rows
  // is analytical (~5s server-side) and must not be killed by the app's tight
  // query_timeout used for hot-path API queries.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 120_000,
    query_timeout: 120_000,
    max: 2,
  });

  // Step 1: select the candidate rows WITHOUT window functions (index-friendly,
  // small result). This avoids a full-table lead/lag sort that chokes the tunnel.
  const selSql = `
    select source_line, sender, body, sent_at
    from messages
    where (
      (char_length(body) >= 15 and body ~ $1)
      or char_length(body) >= 60
    )
    and body !~ 'https?://'
    order by
      (case when body ~ $1 then 1 else 0 end) desc,
      char_length(body) desc
    limit $2
  `;
  const sel = await pool.query(selSql, [SIGNAL_REGEX, limit]);

  // Step 2: fetch context (prev/next message by source_line) ONLY for the
  // selected rows, in one batched query keyed on the chosen source_lines.
  const lines: number[] = sel.rows.map((r) => r.source_line as number);
  const ctxSql = `
    with picks as (select unnest($1::int[]) as sl)
    select
      p.sl,
      (select m2.sender from messages m2 where m2.source_line < p.sl order by m2.source_line desc limit 1) as prev_sender,
      (select m2.body   from messages m2 where m2.source_line < p.sl order by m2.source_line desc limit 1) as prev_body,
      (select m3.body   from messages m3 where m3.source_line > p.sl order by m3.source_line asc  limit 1) as next_body
    from picks p
  `;
  const ctx = await pool.query(ctxSql, [lines]);
  const ctxBySl = new Map<number, { prev_sender: string | null; prev_body: string | null; next_body: string | null }>();
  for (const r of ctx.rows) {
    ctxBySl.set(r.sl as number, { prev_sender: r.prev_sender, prev_body: r.prev_body, next_body: r.next_body });
  }

  const candidates: Candidate[] = sel.rows.map((r) => {
    const c = ctxBySl.get(r.source_line as number);
    return {
      sourceLine: r.source_line,
      sender: r.sender,
      body: r.body,
      sentAt: (r.sent_at as Date).toISOString(),
      prevSender: c?.prev_sender ?? null,
      prevBody: c?.prev_body ?? null,
      nextBody: c?.next_body ?? null,
    };
  });

  writeFileSync(out, JSON.stringify(candidates, null, 2));
  console.log(`Wrote ${candidates.length} candidates → ${out}`);
  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
