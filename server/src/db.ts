/**
 * Database layer for the Maori Ink Screen API.
 *
 * A single shared pg Pool built from DATABASE_URL. On the VPS the API container
 * reaches Postgres over the docker network (postgres://mis:…@mis-postgres:5432/mis);
 * locally it can connect through an SSH tunnel. Either way: DATABASE_URL.
 */
import { Pool } from "pg";

/** A curated, reviewable quote row (camelCase mirror of the `quotes` table). */
export interface Quote {
  id: number;
  messageSourceLine: number;
  /** Full original line (archive/app use). */
  body: string;
  /** The on-screen line. Falls back to `body` when no short form was extracted. */
  displayBody: string;
  speaker: string;
  recipient: string;
  context: string | null;
  score: number;
  category: string;
  sentAt: Date;
  status: QuoteStatus;
  createdAt: Date;
  reviewedAt: Date | null;
}

export type QuoteStatus = "pending" | "approved" | "rejected";

/** Shape of a row as it comes back from Postgres (snake_case). */
interface QuoteRow {
  id: string; // bigint → string from node-pg
  message_source_line: number;
  body: string;
  display_body: string | null;
  speaker: string;
  recipient: string;
  context: string | null;
  score: number;
  category: string;
  sent_at: Date;
  status: QuoteStatus;
  created_at: Date;
  reviewed_at: Date | null;
}

const QUOTE_COLUMNS = `
  id, message_source_line, body, display_body, speaker, recipient,
  context, score, category, sent_at, status, created_at, reviewed_at
`;

function mapRow(r: QuoteRow): Quote {
  return {
    id: Number(r.id),
    messageSourceLine: r.message_source_line,
    body: r.body,
    // Screen shows display_body, falling back to body.
    displayBody: r.display_body ?? r.body,
    speaker: r.speaker,
    recipient: r.recipient,
    context: r.context,
    score: r.score,
    category: r.category,
    sentAt: r.sent_at,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

let pool: Pool | undefined;

/** Lazily-built singleton pool. Throws if DATABASE_URL is missing. */
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL in env.");
  }
  pool = new Pool({
    connectionString,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    max: 5,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Pick one random approved quote, or null when there are none. */
export async function getRandomApprovedQuote(): Promise<Quote | null> {
  const { rows } = await getPool().query<QuoteRow>(
    `select ${QUOTE_COLUMNS}
       from public.quotes
      where status = 'approved'
      order by random()
      limit 1`
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Fetch a single quote by id (any status), or null when missing. */
export async function getQuoteById(id: number): Promise<Quote | null> {
  const { rows } = await getPool().query<QuoteRow>(
    `select ${QUOTE_COLUMNS}
       from public.quotes
      where id = $1
      limit 1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** The review queue: highest-scoring pending quotes first. */
export async function listPending(limit: number): Promise<Quote[]> {
  const { rows } = await getPool().query<QuoteRow>(
    `select ${QUOTE_COLUMNS}
       from public.quotes
      where status = 'pending'
      order by score desc
      limit $1`,
    [limit]
  );
  return rows.map(mapRow);
}

/** Count approved quotes — used by the health check. */
export async function countApproved(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `select count(*)::text as count
       from public.quotes
      where status = 'approved'`
  );
  return Number(rows[0]?.count ?? 0);
}

/** Flip a quote's status and stamp reviewed_at. */
export async function setStatus(id: number, status: QuoteStatus): Promise<void> {
  await getPool().query(
    `update public.quotes
        set status = $2,
            reviewed_at = now()
      where id = $1`,
    [id, status]
  );
}
