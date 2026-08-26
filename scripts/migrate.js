/** Apply SQL migrations in lexical order. */
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const migrationsDir = new URL("../migrations/", import.meta.url);
const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");

  // Existing installations predate migration tracking; their initial schema is already present.
  const { rowCount: hasEndpointsTable } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'endpoints'"
  );
  if (hasEndpointsTable) {
    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", ["001_init.sql"]);
  }

  for (const name of files) {
    const { rowCount } = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDir.pathname, name), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await pool.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await pool.end();
}
