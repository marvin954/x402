/**
 * Crypto Intelligence Route — POST /v1/token-analysis · wallet-analysis · smart-money · newpairs · token-security · market-sentiment
 *
 * On-chain + market intelligence for tokens, wallets, and crypto sentiment.
 * All endpoints are paid marketplace services.
 *
 * Request shapes:
 *   /v1/token-analysis:
 *     { "token": "ethereum", "chain"?: "ethereum"|"solana"|"base"|... }
 *   /v1/wallet-analysis:
 *     { "wallet": "0x...", "chain"?: "ethereum"|"solana"|... }
 *   /v1/smart-money:
 *     { "chain"?: "ethereum"|..., "limit"?: 10, "minPnl"?: 0 }
 *   /v1/newpairs:
 *     { "chain"?: "ethereum"|..., "limit"?: 20, "minLiquidity"?: 10000, "minMarketCap"?: 50000 }
 *   /v1/token-security:
 *     { "token": "ethereum", "chain"?: "ethereum"|... }
 *   /v1/market-sentiment:
 *     { "symbol"?: "BTC", "chains"?: ["ethereum","solana"] }
 */
import { Router } from "express";
import {
  tokenAnalysis,
  walletAnalysis,
  smartMoney,
  newPairs,
  tokenSecurity,
  marketSentiment,
} from "../services/crypto-intelligence.js";

const router = Router();

// ─── POST /v1/token-analysis ────────────────────────────────────────────────────

router.post("/token-analysis", async (req, res) => {
  try {
    const { token, chain } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: 'Request body must contain { "token": "ethereum" | "sol" | "btc" | ... }' });
    }
    if (chain && typeof chain !== "string") {
      return res.status(400).json({ error: '"chain" must be a string (e.g. "ethereum", "solana")' });
    }
    const request = { token, chain: chain || "ethereum" };

    try {
      const result = await tokenAnalysis(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found") || msg.includes("empty")) {
        return res.status(404).json({ error: "Token not found", details: msg });
      }
      return res.status(502).json({ error: "Crypto data provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /token-analysis error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/wallet-analysis ───────────────────────────────────────────────────

router.post("/wallet-analysis", async (req, res) => {
  try {
    const { wallet, chain } = req.body ?? {};
    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: 'Request body must contain { "wallet": "0x..." }' });
    }
    if (!wallet.startsWith("0x") || wallet.length < 42) {
      return res.status(400).json({ error: '"wallet" must be a valid hex address (0x...)' });
    }
    if (chain && typeof chain !== "string") {
      return res.status(400).json({ error: '"chain" must be a string' });
    }
    const request = { wallet, chain: chain || "ethereum" };

    try {
      const result = await walletAnalysis(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found") || msg.includes("invalid") || msg.includes("No results")) {
        return res.status(404).json({ error: "Wallet not found or no data", details: msg });
      }
      return res.status(502).json({ error: "Chain data provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /wallet-analysis error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/smart-money ───────────────────────────────────────────────────────

router.post("/smart-money", async (req, res) => {
  try {
    const { chain, limit, minPnl } = req.body ?? {};
    const request = {
      chain:  chain && typeof chain === "string" ? chain : "ethereum",
      limit:  limit !== undefined && Number.isInteger(limit) ? clamp(limit, 1, 50) : 10,
      minPnl: minPnl !== undefined && typeof minPnl === "number" ? minPnl : 0,
    };

    try {
      const result = await smartMoney(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found")) {
        return res.status(404).json({ error: "No smart money data", details: msg });
      }
      return res.status(502).json({ error: "Chain data provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /smart-money error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/newpairs ──────────────────────────────────────────────────────────

router.post("/newpairs", async (req, res) => {
  try {
    const { chain, limit, minLiquidity, minMarketCap } = req.body ?? {};
    const request = {
      chain:          chain && typeof chain === "string" ? chain : "ethereum",
      limit:          limit !== undefined && Number.isInteger(limit) ? clamp(limit, 1, 100) : 20,
      minLiquidity:   minLiquidity !== undefined && typeof minLiquidity === "number" ? Math.max(0, minLiquidity) : 10000,
      minMarketCap:   minMarketCap !== undefined && typeof minMarketCap === "number" ? Math.max(0, minMarketCap) : 50000,
    };

    try {
      const result = await newPairs(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found") || msg.includes("empty")) {
        return res.status(404).json({ error: "No new pairs found", details: msg });
      }
      return res.status(502).json({ error: "Market data provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /newpairs error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/token-security ────────────────────────────────────────────────────

router.post("/token-security", async (req, res) => {
  try {
    const { token, chain } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: 'Request body must contain { "token": "ethereum" | "sol" | "btc" | ... }' });
    }
    if (chain && typeof chain !== "string") {
      return res.status(400).json({ error: '"chain" must be a string' });
    }
    const request = { token, chain: chain || "ethereum" };

    try {
      const result = await tokenSecurity(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found") || msg.includes("empty")) {
        return res.status(404).json({ error: "Token not found", details: msg });
      }
      return res.status(502).json({ error: "Security scan provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /token-security error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/market-sentiment ──────────────────────────────────────────────────

router.post("/market-sentiment", async (req, res) => {
  try {
    const { symbol, chains } = req.body ?? {};
    if (symbol !== undefined && typeof symbol !== "string") {
      return res.status(400).json({ error: '"symbol" must be a string (e.g. "BTC")' });
    }
    if (chains !== undefined && !Array.isArray(chains)) {
      return res.status(400).json({ error: '"chains" must be an array of strings' });
    }
    const request = {
      symbol: symbol || undefined,
      chains: chains && chains.length ? chains.filter((c) => typeof c === "string") : undefined,
    };

    try {
      const result = await marketSentiment(request);
      res.json(result);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("404") || msg.includes("not found") || msg.includes("empty")) {
        return res.status(404).json({ error: "Sentiment data not found", details: msg });
      }
      return res.status(502).json({ error: "Sentiment provider error", details: msg });
    }
  } catch (err) {
    console.error("[crypto-intelligence] /market-sentiment error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default router;
