/**
 * Website Intelligence Route — POST /v1/website/intelligence
 *
 * Scrapes a target URL and returns structured intelligence:
 *   { title, description, image, favicon, social_links[], contacts[], technologies[], content_summary }
 */
import { Router } from "express";
import { scrapeWebsite } from "../services/intelligence.js";

const router = Router();

/**
 * POST /v1/website/intelligence
 * Body: { "url": "https://..." }
 * Returns the full structured intelligence payload.
 *
 * This is a FREE direct endpoint (no x402 payment). The marketplace also
 * lists a paid proxy version if a provider registers one at
 * /proxy/website-intelligence — but the /v1 route is always free.
 */
router.post("/website/intelligence", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({
        error: 'Request body must contain { "url": "https://..." }',
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return res.status(400).json({
        error: "Invalid URL — must be an absolute https:// or http:// URL",
      });
    }

    if (!targetUrl.protocol.startsWith("http")) {
      return res.status(400).json({
        error: "URL must use http: or https: scheme",
      });
    }

    if (targetUrl.href.length > 2048) {
      return res.status(400).json({ error: "URL too long" });
    }

    const start = Date.now();

    const result = await scrapeWebsite(targetUrl.href);
    const timeMs = Date.now() - start;

    res.json({
      ...result,
      _meta: {
        url:           targetUrl.href,
        fetchedAt:     new Date().toISOString(),
        responseTimeMs: timeMs,
      },
    });
  } catch (err) {
    console.error("[intelligence] scrape error:", err.message);
    res.status(502).json({
      error: "Failed to scrape URL — the target may be unreachable or blocking automated requests.",
      details: err.message,
    });
  }
});

export default router;
