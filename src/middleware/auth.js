/**
 * Authentication middleware
 * Providers authenticate with their API key (X-API-Key header)
 * Admin routes require ADMIN_API_KEY
 */
import { providers } from "../db/queries.js";

/**
 * Require a valid provider API key
 * Attaches req.provider = { id, name, email, wallet_address, ... }
 */
export async function requireProvider(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({
      error: "Missing X-API-Key header",
      hint: "Register at /api/providers/register to get your API key",
    });
  }

  const provider = await providers.findByApiKey(apiKey);
  if (!provider) {
    return res.status(401).json({ error: "Invalid or inactive API key" });
  }

  req.provider = provider;
  next();
}

/**
 * Require the platform admin key
 */
export function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.admin_key;
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: "Forbidden — invalid admin key" });
  }
  next();
}
