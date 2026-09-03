import express from "express";

const router = express.Router();

// Debug route to see environment variables (with secrets masked)
router.get("/env", (req, res) => {
  const env = {};
  for (const key in process.env) {
    if (key.includes('KEY') || key.includes('TOKEN') || key.includes('SECRET') || key.includes('PASSWORD') || key.includes('URL')) {
      env[key] = '[SENSITIVE]';
    } else {
      env[key] = process.env[key];
    }
  }
  res.json(env);
});

// Debug route to test database connection
router.get("/db-test", async (req, res) => {
  try {
    const { query } = await import("../db/pool.js");
    const result = await query("SELECT 1");
    res.json({ success: true, result: result.rows[0] });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Debug route to test marketplace endpoint query
router.get("/marketplace-test", async (req, res) => {
  try {
    const { endpoints } = await import("../db/queries.js");
    const data = await endpoints.listMarketplace({ limit: 5 });
    res.json({ success: true, count: data.length, first: data[0] });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Debug route to see raw endpoints data
router.get("/debug-endpoints", async (req, res) => {
  try {
    const { query } = await import("../db/pool.js");
    const result = await query("SELECT slug, query_parameters FROM endpoints ORDER BY slug");
    res.json({ success: true, endpoints: result.rows });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Debug route to see the view data
router.get("/debug-view", async (req, res) => {
  try {
    const { query } = await import("../db/pool.js");
    const result = await query("SELECT slug, query_parameters FROM v_marketplace_listing ORDER BY slug");
    res.json({ success: true, endpoints: result.rows });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

export default router;