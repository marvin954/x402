/**
 * PostgreSQL connection pool
 * Single pool instance shared across the whole app
 */
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                  // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

/**
 * Run a query with automatic connection management
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 80));
    }
    return res;
  } catch (err) {
    console.error("[DB] Query error:", err.message, "\nSQL:", text.slice(0, 120));
    throw err;
  }
}

/**
 * Run multiple queries in a transaction
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Wait until the DB is ready (used at startup)
 */
export async function waitForDB(retries = 60, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[DB] Connected to PostgreSQL ✓");
      return;
    } catch {
      console.log(`[DB] Waiting for PostgreSQL... (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("[DB] Could not connect to PostgreSQL after retries");
}

export default pool;
