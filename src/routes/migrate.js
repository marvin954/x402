import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const router = express.Router();

function getConnectionString() {
  // Construct connection string from individual POSTGRES variables if needed
  let connectionString = process.env.storage_DATABASE_URL || process.env.DATABASE_URL || process.env.x4_DATABASE_URL;

  // If we have individual POSTGRES variables but no DATABASE_URL, construct it
  if (!connectionString &&
      process.env.POSTGRES_USER &&
      process.env.POSTGRES_PASSWORD &&
      process.env.POSTGRES_DB) {
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    connectionString = `postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${host}:${port}/${process.env.POSTGRES_DB}`;
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set in Vercel env vars.");
  }

  return connectionString;
}

router.get("/", async (req, res) => {
  // Check for the migration token in the query string or header
  const token = req.query.token || req.headers["x-migrate-token"];
  const expectedToken = process.env.MIGRATE_TOKEN;

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const migrationsDir = path.join(process.cwd(), 'migrations');
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const pool = new pg.Pool({ connectionString: getConnectionString() });

    try {
      // Create schema_migrations table if it doesn't exist
      await pool.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
      );

      // Check if the endpoints table already exists (for existing installations)
      const { rowCount: hasEndpointsTable } = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'endpoints'"
      );
      if (hasEndpointsTable) {
        await pool.query(
          "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
          ["001_init.sql"]
        );
      }

      // Apply each migration that hasn't been applied yet
      for (const name of files) {
        const { rowCount } = await pool.query(
          "SELECT 1 FROM schema_migrations WHERE name = $1",
          [name]
        );
        if (rowCount) continue; // Skip if already applied

        const sql = await fs.readFile(
          path.join(migrationsDir, name),
          "utf8"
        );
        await pool.query("BEGIN");
        try {
          await pool.query(sql);
          await pool.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [name]
          );
          await pool.query("COMMIT");
          console.log(`Applied migration: ${name}`);
        } catch (error) {
          await pool.query("ROLLBACK");
          throw error;
        }
      }

      res.json({
        status: "success",
        message: "Migrations applied successfully",
        applied: files.map((f) => ({ name: f, applied: true }))
      });
    } finally {
      await pool.end();
    }
  } catch (err) {
    console.error("[migrate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;