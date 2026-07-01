import { Pool } from "pg";

/**
 * Single shared pg Pool. Self-hosted Postgres lives in a Docker container on
 * your VPS, bound to localhost only — never exposed to the internet. Scripts
 * connect over an SSH tunnel; the on-VPS REST API connects over the docker
 * network. Both supply DATABASE_URL.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL in env.");
  }
  pool = new Pool({
    connectionString,
    // Generous timeouts: the import script does large batched writes.
    statement_timeout: 60_000,
    query_timeout: 60_000,
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
