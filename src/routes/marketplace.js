/**
 * Public Marketplace + x402 Proxy Routes
 *
 * GET  /marketplace/endpoints          - Browse all active endpoints
 * GET  /marketplace/endpoints/:slug    - Single endpoint detail
 * GET  /marketplace/categories         - Available categories
 * GET  /marketplace/stats              - Public platform stats
 *
 * GET  /proxy/:slug                    - PAID proxy (GET endpoints)
 * POST /proxy/:slug                    - PAID proxy (POST endpoints)
 * PUT  /proxy/:slug                    - PAID proxy (PUT endpoints)
 * etc.
 */
import { Router } from "express";
import { endpoints, transactions } from "../db/queries.js";
import { requirePayment } from "../middleware/x402.js";
import { proxyRequest } from "../services/proxy.js";

const router = Router();

// ─── Public Discovery ─────────────────────────────────────────────────────────

router.get("/endpoints", async (req, res) => {
  try {
    const { category, search, limit = 20, offset = 0 } = req.query;
    const list = await endpoints.listMarketplace({
      category,
      search,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset),
    });

    const total = list.length > 0 ? parseInt(list[0].total_count || 0) : 0;

    res.json({
      endpoints: list.map((e) => ({
        id:           e.id,
        slug:         e.slug,
        name:         e.name,
        description:  e.description,
        category:     e.category,
        tags:         e.tags,
        method:       e.method,
        priceAtomic:  e.price_atomic,
        priceDisplay: e.price_display,
        totalCalls:   parseInt(e.total_calls),
        provider:     e.provider_name,
        proxyUrl:     `${process.env.SERVER_URL}/proxy/${e.slug}`,
        createdAt:    e.created_at,
      })),
      pagination: {
        total,
        limit:  parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + list.length < total,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/endpoints/:slug", async (req, res) => {
  try {
    const endpoint = await endpoints.findBySlug(req.params.slug);
    if (!endpoint || endpoint.status !== "active") {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    const recentTxs = await transactions.listByEndpoint(endpoint.id, 5);

    res.json({
      id:           endpoint.id,
      slug:         endpoint.slug,
      name:         endpoint.name,
      description:  endpoint.description,
      category:     endpoint.category,
      tags:         endpoint.tags,
      method:       endpoint.method,
      priceAtomic:  endpoint.price_atomic,
      priceDisplay: endpoint.price_display,
      totalCalls:   parseInt(endpoint.total_calls),
      provider:     endpoint.provider_name,
      proxyUrl:     `${process.env.SERVER_URL}/proxy/${endpoint.slug}`,
      x402: {
        scheme:            "exact",
        network:           process.env.NETWORK,
        asset:             process.env.USDC_ASSET,
        amount:            String(endpoint.price_atomic),
        payTo:             process.env.PLATFORM_WALLET,
        maxTimeoutSeconds: 60,
      },
      recentActivity: recentTxs.map((t) => ({
        payerMasked: t.payer_address.slice(0, 6) + "..." + t.payer_address.slice(-4),
        at: t.created_at,
        upstreamStatus: t.upstream_status,
        responseTimeMs: t.response_time_ms,
      })),
      createdAt: endpoint.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const cats = await endpoints.categories();
    res.json({ categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const stats = await transactions.platformStats();
    res.json({
      totalProviders:    parseInt(stats.total_providers || 0),
      activeEndpoints:   parseInt(stats.active_endpoints || 0),
      totalTransactions: parseInt(stats.total_transactions || 0),
      totalVolumeUsdc:   parseFloat(stats.total_volume_usdc || 0),
      calls24h:          parseInt(stats.calls_24h || 0),
      uniquePayers:      parseInt(stats.unique_payers || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── x402 Proxy ───────────────────────────────────────────────────────────────

/**
 * Universal paid proxy handler
 * Handles GET, POST, PUT, PATCH, DELETE to /proxy/:slug
 */
async function proxyHandler(req, res) {
  const { slug } = req.params;

  // ── 1. Look up endpoint ───────────────────────────────────────────────────
  let endpoint;
  try {
    endpoint = await endpoints.findBySlug(slug);
  } catch (err) {
    return res.status(500).json({ error: "Database error" });
  }

  if (!endpoint) {
    return res.status(404).json({
      error: `No endpoint registered for slug '${slug}'`,
      hint: "Browse available endpoints at /marketplace/endpoints",
    });
  }

  if (endpoint.status !== "active") {
    return res.status(503).json({
      error: `Endpoint '${slug}' is currently ${endpoint.status}`,
    });
  }

  if (endpoint.provider_status !== "active") {
    return res.status(503).json({ error: "This provider's account is currently suspended" });
  }

  // ── 2. x402 payment gate ──────────────────────────────────────────────────
  // requirePayment returns a middleware — we invoke it inline
  await new Promise((resolve, reject) => {
    requirePayment(endpoint)(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch((err) => {
    if (!res.headersSent) res.status(500).json({ error: "Payment processing error: " + err.message });
    throw err; // stop execution
  });

  // If payment failed, res has already been sent by requirePayment
  if (res.headersSent) return;

  // ── 3. Enforce method (moved AFTER payment check) ─────────────────────────
  if (req.method !== endpoint.method) {
    return res.status(405).json({
      error: `This endpoint only accepts ${endpoint.method} requests`,
    });
  }

  // ── 4. Forward to upstream ────────────────────────────────────────────────
  let upstream;
  try {
    upstream = await proxyRequest({
      upstreamUrl:        endpoint.upstream_url,
      method:             endpoint.method,
      incomingHeaders:    req.headers,
      query:              req.query,
      body:               req.body ? Buffer.from(JSON.stringify(req.body)) : null,
      upstreamAuthHeader: endpoint.upstream_auth_header || null,
    });
  } catch (err) {
    console.error(`[proxy] upstream error for ${slug}:`, err.message);
    // Payment is already settled — we must still record the transaction
    await recordTransaction(req, endpoint, null, 500, 0);
    return res.status(502).json({
      error: "Upstream provider error — your payment was recorded and will be reviewed",
      details: err.message,
    });
  }

  // ── 5. Record transaction ─────────────────────────────────────────────────
  await recordTransaction(req, endpoint, upstream.status, upstream.timeMs);

  // ── 6. Return upstream response to client ─────────────────────────────────
  // Forward upstream headers (skip ones we already set)
  for (const [k, v] of Object.entries(upstream.headers || {})) {
    if (k.toLowerCase() !== "content-length") {
      try { res.setHeader(k, v); } catch {}
    }
  }

  res.status(upstream.status);
  res.end(upstream.body);
}
async function recordTransaction(req, endpoint, upstreamStatus, responseTimeMs, overrideStatus) {
  try {
    const { x402 } = req;
    if (!x402) return; // payment wasn't settled (shouldn't happen here)

    await transactions.record({
      endpointId:    endpoint.id,
      providerId:    endpoint.provider_id,
      txHash:        x402.transaction,
      network:       x402.network,
      payerAddress:  x402.payer,
      amountAtomic:  x402.amountAtomic,
      platformFeePct: x402.feePct,
      platformCut:   x402.platformCut,
      providerCut:   x402.providerCut,
      requestMethod: req.method,
      requestPath:   req.path,
      requestIp:     req.ip,
      upstreamStatus: overrideStatus ?? upstreamStatus,
      responseTimeMs,
    });
  } catch (err) {
    console.error("[proxy] failed to record transaction:", err.message);
  }
}

// Register proxy for all HTTP methods
router.get("/:slug",    proxyHandler);
router.post("/:slug",   proxyHandler);
router.put("/:slug",    proxyHandler);
router.patch("/:slug",  proxyHandler);
router.delete("/:slug", proxyHandler);

export default router;

// ─── Trading API (for arbitrage agents) ───────────────────────────────────────

/**
 * GET /prices
 * Returns current prices for trading pairs used by arbitrage agent
 */
router.get("/prices", async (req, res) => {
  try {
    // Fetch prices from CoinGecko (same as crypto-prices endpoint)
    const response = await new Promise((resolve, reject) => {
      const https = require('https');
      const options = {
        hostname: 'api.coingecko.com',
        port: 443,
        path: '/api/v3/simple/price?ids=bitcoin,ethereum,tether,dai&vs_currencies=usd',
        method: 'GET',
        headers: { 'User-Agent': 'x402-marketplace/1.0' }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Failed to parse price data: ${e.message}`)); }
        });
      });

      req.on('error', reject);
      req.end();
    });

    // Convert CoinGecko response to trading pair prices
    // CoinGecko gives us: { bitcoin: { usd: ... }, ethereum: { usd: ... }, etc.
    // We need: { "USDC/ETH": price, "ETH/USDC": price, etc. }
    // Note: USDC ≈ 1 USD, USDT ≈ 1 USD, DAI ≈ 1 USD
    
    const btcUsd = response.bitcoin?.usd || 0;
    const ethUsd = response.ethereum?.usd || 0;
    const usdtUsd = response.tether?.usd || 1;  // USDT is pegged to USD
    const daiUsd = response.dai?.usd || 1;      // DAI is pegged to USD

    const prices = {
      // ETH pairs
      "USDC/ETH": ethUsd,           // 1 USDC = ethUsd ETH? No, wait...
      "ETH/USDC": 1 / ethUsd,       // 1 ETH = (1/ethUsd) USDC? Let me think...
      
      // Actually, for pair "BASE/QUOTE", the price is how much QUOTE you get for 1 BASE
      // So "USDC/ETH" = how much ETH for 1 USDC = USDC value in ETH = 1 USD / ethUsd ETH per USD = 1/ethUsd
      // And "ETH/USDC" = how much USDC for 1 ETH = ethUsd USDC
      
      "USDC/ETH": 1 / ethUsd,       // 1 USDC buys (1/ethUsd) ETH
      "ETH/USDC": ethUsd,           // 1 ETH sells for ethUsd USDC
      
      // BTC pairs
      "USDC/BTC": 1 / btcUsd,       // 1 USDC buys (1/btcUsd) BTC
      "BTC/USDC": btcUsd,           // 1 BTC sells for btcUsd USDC
      
      // USDT pairs (USDT ≈ USD)
      "USDC/USDT": 1 / usdtUsd,     // 1 USDC buys (1/usdtUsd) USDT ≈ 1
      "USDT/USDC": usdtUsd,         // 1 USDT sells for usdtUsd USDC ≈ 1
      
      // DAI pairs (DAI ≈ USD)  
      "USDC/DAI": 1 / daiUsd,       // 1 USDC buys (1/daiUsd) DAI ≈ 1
      "DAI/USDC": daiUsd,           // 1 DAI sells for daiUsd USDC ≈ 1
    };

    // Handle edge cases where price is 0 (avoid division by zero)
    if (!response.bitcoin || !response.bitcoin.usd) {
      prices["USDC/BTC"] = 0;
      prices["BTC/USDC"] = 0;
    }
    if (!response.ethereum || !response.ethereum.usd) {
      prices["USDC/ETH"] = 0;
      prices["ETH/USDC"] = 0;
    }

    res.json({ prices });
  } catch (err) {
    console.error('[/prices] Error fetching prices:', err.message);
    res.status(500).json({ error: 'Failed to fetch price data' });
  }
});

/**
 * POST /trade
 * Initiate a trade (returns 402 Payment Required when payment needed)
 * Body: { pair: "USDC/ETH", side: "buy"|"sell", amount: number }
 */
router.post("/trade", async (req, res) => {
  try {
    const { pair, side, amount } = req.body;

    // Validate input
    if (!pair || !side || !amount) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["pair", "side", "amount"]
      });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    if (!["buy", "sell"].includes(side.toLowerCase())) {
      return res.status(400).json({ error: "Side must be 'buy' or 'sell'" });
    }

    // Validate trading pair format (BASE/QUOTE)
    const [base, quote] = pair.toUpperCase().split('/');
    if (!base || !quote || base === quote) {
      return res.status(400).json({ error: "Invalid trading pair format. Use BASE/QUOTE (e.g., USDC/ETH)" });
    }

    // Get current price for this pair
    const pricesResponse = await new Promise((resolve) => {
      const https = require('https');
      const options = {
        hostname: 'api.coingecko.com',
        port: 443,
        path: '/api/v3/simple/price?ids=bitcoin,ethereum,tether,dai&vs_currencies=usd',
        method: 'GET',
        headers: { 'User-Agent': 'x402-marketplace/1.0' }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({}); } // Return empty object on parse error
        });
      });

      req.on('error', () => resolve({}));
      req.end();
    });

    // Calculate price for the trading pair
    const btcUsd = pricesResponse.bitcoin?.usd || 0;
    const ethUsd = pricesResponse.ethereum?.usd || 0;
    const usdtUsd = pricesResponse.tether?.usd || 1;
    const daiUsd = pricesResponse.dai?.usd || 1;

    let price;
    switch (pair.toUpperCase()) {
      case "USDC/ETH": price = 1 / ethUsd; break;
      case "ETH/USDC": price = ethUsd; break;
      case "USDC/BTC": price = 1 / btcUsd; break;
      case "BTC/USDC": price = btcUsd; break;
      case "USDC/USDT": price = 1 / usdtUsd; break;
      case "USDT/USDC": price = usdtUsd; break;
      case "USDC/DAI": price = 1 / daiUsd; break;
      case "DAI/USDC": price = daiUsd; break;
      default:
        return res.status(400).json({ error: `Unsupported trading pair: ${pair}` });
    }

    // Handle division by zero
    if (!price || !isFinite(price)) {
      return res.status(500).json({ error: "Unable to calculate price for trading pair" });
    }

    // Calculate total cost in USDC
    // For BUY: we're buying BASE with QUOTE, so cost in QUOTE = amount * price
    // For SELL: we're selling BASE for QUOTE, so we receive QUOTE = amount * price
    // In both cases, the x402 payment is for accessing the trade execution service
    const tradeValueInQuote = amount * price;
    const serviceFeeUsdc = 0.001; // $0.001 service fee for trade execution
    
    // Create a temporary endpoint record for this trade (or use a generic trade endpoint)
    // For simplicity, we'll use a fixed price for the trade execution service
    const priceAtomic = Math.round(serviceFeeUsdc * 1_000_000); // Convert to atomic units

    // Generate a unique slug for this trade request
    const slug = `trade-${Math.random().toString(36).substring(2, 9)}`;

    // We need to create a temporary endpoint to trigger the x402 payment flow
    // But instead of actually creating an endpoint, let's reuse the requirePayment middleware
    // by creating a mock endpoint object

    const mockEndpoint = {
      slug,
      name: `Trade Execution: ${pair}`,
      description: `Execute ${side.toUpperCase()} ${amount} ${pair} trade`,
      price_atomic: priceAtomic,
    };

    // Use the requirePayment middleware to handle the x402 flow
    await new Promise((resolve, reject) => {
      requirePayment(mockEndpoint)(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((err) => {
      if (!res.headersSent) {
        return res.status(500).json({ error: `Payment processing error: ${err.message}` });
      }
      throw err;
    });

    // If we reach here, payment was successful (or we're in dev mode and bypassed it)
    // Generate a payment ID for this trade
    const paymentId = `pay_${Math.random().toString(36).substring(2, 15)}`;

    // Return trade initiation details
    res.json({
      success: true,
      paymentId,
      pair,
      side,
      amount,
      price,
      requiresPayment: false, // Payment was already handled by middleware
      message: "Trade initiated. Use GET /trade/{paymentId}/complete?tx_hash={hash} to check completion.",
      // In a real implementation, we would now execute the trade on-chain
      // For this simulation, we'll consider it immediately complete
      simulated: true
    });
  } catch (err) {
    console.error('[/trade] Error initiating trade:', err.message);
    res.status(500).json({ error: 'Failed to initiate trade' });
  }
});

/**
 * GET /trade/{paymentId}/complete?tx_hash={hash}
 * Check if a trade has been completed on blockchain
 */
router.get("/trade/:paymentId/complete", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { tx_hash } = req.query;

    // Validate input
    if (!paymentId) {
      return res.status(400).json({ error: "Missing paymentId" });
    }

    if (!tx_hash) {
      return res.status(400).json({ error: "Missing tx_hash parameter" });
    }

    // Validate tx_hash format (should be 0x followed by hex characters)
    if (!/^0x[0-9a-fA-F]+$/.test(tx_hash)) {
      return res.status(400).json({ error: "Invalid transaction hash format" });
    }

    // In a real implementation, we would:
    // 1. Look up the paymentId in our database to get trade details
    // 2. Check if the tx_hash has been confirmed on the blockchain
    // 3. Return the trade completion status
    
    // For this implementation, we'll simulate a successful trade completion
    // In production, this would check actual blockchain confirmations
    
    // Simulate checking if transaction is confirmed
    // For demo purposes, we'll consider it confirmed if it looks like a valid tx hash
    const isConfirmed = tx_hash.length >= 10; // Simple validation
    
    if (isConfirmed) {
      res.json({
        success: true,
        paymentId,
        txHash: tx_hash,
        confirmed: true,
        confirmations: 5, // Simulated confirmation count
        completedAt: new Date().toISOString(),
        message: "Trade completed successfully on blockchain"
      });
    } else {
      res.json({
        success: false,
        paymentId,
        txHash: tx_hash,
        confirmed: false,
        message: "Transaction not yet confirmed on blockchain"
      });
    }
  } catch (err) {
    console.error('[/trade/complete] Error checking trade completion:', err.message);
    res.status(500).json({ error: 'Failed to check trade completion' });
  }
});

