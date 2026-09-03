import express from "express";
import { query } from "../db/pool.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    // Get list of views
    const viewsResult = await query(
      "SELECT table_name FROM information_schema.views WHERE table_schema = 'public'"
    );
    const views = viewsResult.rows.map(r => r.table_name);

    // Check for specific views
    const marketplaceView = await query(
      "SELECT EXISTS (SELECT FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_marketplace_listing')"
    );
    const providerView = await query(
      "SELECT EXISTS (SELECT FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_provider_dashboard')"
    );
    const statsView = await query(
      "SELECT EXISTS (SELECT FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_platform_stats')"
    );

    // If marketplace view exists, get a count
    let marketplaceCount = null;
    if (marketplaceView.rows[0].exists) {
      const countResult = await query('SELECT COUNT(*) as count FROM v_marketplace_listing');
      marketplaceCount = countResult.rows[0].count;
    }

    // Environment info (excluding secrets)
    const envInfo = {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: process.env.VERCEL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      POSTGRES_USER: process.env.POSTGRES_USER ? '[SET]' : '[NOT SET]',
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ? '[SET]' : '[NOT SET]',
      POSTGRES_DB: process.env.POSTGRES_DB ? '[SET]' : '[NOT SET]',
      POSTGRES_HOST: process.env.POSTGRES_HOST ? '[SET]' : '[NOT SET]',
      POSTGRES_PORT: process.env.POSTGRES_PORT ? '[SET]' : '[NOT SET]',
      DATABASE_URL: process.env.DATABASE_URL ? '[SET]' : '[NOT SET]',
      // Check if we can construct a connection string from individual POSTGRES variables
      connectionStringConstructable: !!(
        process.env.POSTGRES_USER &&
        process.env.POSTGRES_PASSWORD &&
        process.env.POSTGRES_DB &&
        process.env.POSTGRES_HOST &&
        process.env.POSTGRES_PORT
      )
    };

    res.json({
      views,
      v_marketplace_listing_exists: marketplaceView.rows[0].exists,
      v_provider_dashboard_exists: providerView.rows[0].exists,
      v_platform_stats_exists: statsView.rows[0].exists,
      v_marketplace_listing_count: marketplaceCount,
      environment: envInfo
    });
  } catch (err) {
    console.error("[debug] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;