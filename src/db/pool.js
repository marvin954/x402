import pg from "pg";
const { Pool } = pg;
let _pool = null;

function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.storage_DATABASE_URL || process.env.DATABASE_URL || process.env.x4_DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in Vercel env vars.");
  const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
  _pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, ssl: !isLocal ? { rejectUnauthorized: false } : false });
  _pool.on("error", (err) => { console.error("[DB] Pool error:", err.message); _pool = null; });
  return _pool;
}

export async function query(text, params) {
  try { return await getPool().query(text, params); }
  catch (err) { console.error("[DB] Query error:", err.message); throw err; }
}

export async function transaction(fn) {
  const client = await getPool().connect();
  try { await client.query("BEGIN"); const r = await fn(client); await client.query("COMMIT"); return r; }
  catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

export async function waitForDB() {
  try { await getPool().query("SELECT 1"); console.log("[DB] Connected ✓"); }
  catch (err) { throw new Error("[DB] Cannot connect: " + err.message); }
}

export default { query, transaction, waitForDB };
