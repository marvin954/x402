/**
 * Business Intelligence Route — POST /v1/business/intelligence
 *
 * Combines website scraping with business enrichment:
 *   Business info · Website analysis · Contact extraction
 *   Technology detection · Social profiles · AI lead score (0-100)
 *
 * Input:  { "businessName"?: string, "url": "https://..." }
 * Output: {
 *   business:        { name, website, industry, estimatedSize, location, description }
 *   website:         { title, description, image, favicon, social_links[], technologies[], content_summary }
 *   contacts:        { emails[], phones[], addresses[], social_profiles[] }
 *   leadScore:       { score: 0-100, grade: "A"|"B"|"C"|"D", breakdown: {...} }
 *   _meta:           { url, businessName, fetchedAt, responseTimeMs }
 * }
 */
import { Router } from "express";
import { enrichBusiness } from "../services/business-intelligence.js";

const router = Router();

/**
 * POST /v1/business/intelligence
 * Body: { "url": "https://...", "businessName"?: "Acme Corp" }
 * Returns full business intelligence report + lead score (0-100).
 *
 * This is a PAID endpoint — $0.25 per call. The route itself does NOT
 * enforce x402 payment here; it is a direct API. The marketplace lists
 * a paid proxy version at /proxy/business-intelligence for agents that
 * use x402 payment headers.
 */
router.post("/business/intelligence", async (req, res) => {
  try {
    const { url, businessName } = req.body;

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

    const result = await enrichBusiness({ url: targetUrl.href, businessName });

    res.json(result);
  } catch (err) {
    console.error("[business-intel] error:", err.message);
    res.status(502).json({
      error: "Failed to generate business intelligence report.",
      details: err.message,
    });
  }
});

export default router;
