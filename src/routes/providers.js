/**
 * Provider API routes
 *
 * POST /api/providers/register         - Create account, get API key
 * GET  /api/providers/me               - My profile + dashboard stats
 * GET  /api/providers/me/endpoints     - My endpoints
 * POST /api/providers/me/endpoints     - Register a new endpoint
 * PUT  /api/providers/me/endpoints/:id - Update endpoint
 * DEL  /api/providers/me/endpoints/:id - Delete endpoint (soft)
 * POST /api/providers/me/rotate-key    - Rotate API key
 * PUT  /api/providers/me/wallet        - Update payout wallet
 * GET  /api/providers/me/transactions  - My transaction history
 * GET  /api/providers/me/payouts       - My payout history
 * GET  /api/providers/me/analytics     - Time-series + top endpoints
 */
import { Router } from "express";
import { providers, endpoints, transactions, payouts } from "../db/queries.js";
import { requireProvider } from "../middleware/auth.js";
import { uniqueSlug, isValidSlug } from "../lib/slugify.js";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, walletAddress } = req.body;

    if (!name || !email || !walletAddress) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["name", "email", "walletAddress"],
      });
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address — must be a 0x EVM address" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    const existing = await providers.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const provider = await providers.create({ name, email, walletAddress });

    res.status(201).json({
      message: "Provider registered successfully",
      provider: {
        id:           provider.id,
        name:         provider.name,
        email:        provider.email,
        walletAddress: provider.wallet_address,
        apiKey: provider.api_key,
        status:       provider.status,
        createdAt:    provider.created_at,
      },
      next: "Store your API key — include it as X-API-Key on all provider requests",
    });
  } catch (err) {
    console.error("[providers] register error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── All routes below require auth ──────────────────────────────────────────────
router.use(requireProvider);

// ─── Profile ──────────────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  try {
    const dashboard = await providers.dashboard(req.provider.id);
    res.json({
      id:             dashboard.id,
      name:           dashboard.name,
      email:          dashboard.email,
      walletAddress:  dashboard.wallet_address,
      status:         dashboard.status,
      stats: {
        endpointCount:   parseInt(dashboard.endpoint_count),
        totalEarnedUsdc: parseFloat(dashboard.total_earned_usdc),
        totalGrossUsdc:  parseFloat(dashboard.total_gross_usdc),
        totalCalls:      parseInt(dashboard.total_calls),
        totalPaidOut:    parseFloat(dashboard.total_paid_out),
        balancePending:  parseFloat(dashboard.balance_pending),
      },
      createdAt: dashboard.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/me/wallet", async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const updated = await providers.updateWallet(req.provider.id, walletAddress);
    res.json({ walletAddress: updated.wallet_address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/rotate-key", async (req, res) => {
  try {
    const newKey = await providers.rotateApiKey(req.provider.id);
    res.json({
      apiKey: newKey,
      message: "API key rotated — update your integrations immediately",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Endpoints ────────────────────────────────────────────────────────────────

router.get("/me/endpoints", async (req, res) => {
  try {
    const list = await endpoints.listByProvider(req.provider.id);
    res.json({ endpoints: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/endpoints", async (req, res) => {
  try {
    const {
      name, description, category = "general", tags = [],
      upstreamUrl, method = "GET",
      priceUsdc,         // human-readable, e.g. 0.01
      priceAtomic,       // raw atomic units, overrides priceUsdc if provided
      slug: requestedSlug,
      upstreamAuthHeader,  // optional: "Bearer sk-..." injected on upstream calls
    } = req.body;

    // Validation
    if (!name || !upstreamUrl) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["name", "upstreamUrl"],
        optional: ["description", "category", "tags", "method", "priceUsdc", "slug", "upstreamAuthHeader"],
      });
    }

    if (!["GET","POST","PUT","PATCH","DELETE"].includes(method.toUpperCase())) {
      return res.status(400).json({ error: "Invalid method" });
    }

    try { new URL(upstreamUrl); }
    catch { return res.status(400).json({ error: "Invalid upstreamUrl — must be a full https:// URL" }); }

    if (requestedSlug && !isValidSlug(requestedSlug)) {
      return res.status(400).json({
        error: "Invalid slug — lowercase letters, numbers, hyphens only, 3-50 chars",
      });
    }

    // Price resolution
    let finalPriceAtomic;
    if (priceAtomic) {
      finalPriceAtomic = parseInt(priceAtomic, 10);
    } else if (priceUsdc) {
      finalPriceAtomic = Math.round(parseFloat(priceUsdc) * 1_000_000);
    } else {
      return res.status(400).json({ error: "Provide priceUsdc (e.g. 0.01) or priceAtomic (e.g. 10000)" });
    }

    if (finalPriceAtomic < 1000) {
      return res.status(400).json({ error: "Minimum price is $0.001 USDC (1000 atomic units)" });
    }

    if (finalPriceAtomic > 100_000_000) {
      return res.status(400).json({ error: "Maximum price is $100 USDC per call" });
    }

    const slug = await uniqueSlug(name, requestedSlug);
    const feePct = parseFloat(process.env.PLATFORM_FEE_PERCENT || "15");

    const endpoint = await endpoints.create({
      providerId: req.provider.id,
      slug,
      name,
      description: description || "",
      category: category.toLowerCase(),
      tags: Array.isArray(tags) ? tags.map(t => t.toLowerCase()) : [],
      upstreamUrl,
      method: method.toUpperCase(),
      priceAtomic: finalPriceAtomic,
      upstreamAuthHeader: upstreamAuthHeader || null,
    });

    const providerEarns = parseFloat(((finalPriceAtomic / 1_000_000) * (1 - feePct / 100)).toFixed(6));

    res.status(201).json({
      message: "Endpoint registered — submit for review or activate directly",
      endpoint: {
        id:           endpoint.id,
        slug:         endpoint.slug,
        name:         endpoint.name,
        description:  endpoint.description,
        category:     endpoint.category,
        method:       endpoint.method,
        priceAtomic:  endpoint.price_atomic,
        priceDisplay: endpoint.price_display,
        status:       endpoint.status,
        marketplaceUrl: `${process.env.SERVER_URL}/proxy/${endpoint.slug}`,
        createdAt:    endpoint.created_at,
      },
      economics: {
        pricePerCallUsdc: finalPriceAtomic / 1_000_000,
        platformFeePercent: feePct,
        yourEarningsPerCall: providerEarns,
      },
    });
  } catch (err) {
    console.error("[providers] create endpoint:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/me/endpoints/:id", async (req, res) => {
  try {
    const { priceUsdc, priceAtomic, ...rest } = req.body;

    const fields = { ...rest };
    if (priceAtomic)      fields.price_atomic = parseInt(priceAtomic, 10);
    else if (priceUsdc)   fields.price_atomic = Math.round(parseFloat(priceUsdc) * 1_000_000);

    const updated = await endpoints.update(req.params.id, req.provider.id, fields);
    if (!updated) return res.status(404).json({ error: "Endpoint not found" });
    res.json({ endpoint: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/me/endpoints/:id", async (req, res) => {
  try {
    const updated = await endpoints.updateStatus(req.params.id, req.provider.id, "deleted");
    if (!updated) return res.status(404).json({ error: "Endpoint not found" });
    res.json({ message: "Endpoint deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/endpoints/:id/activate", async (req, res) => {
  try {
    const updated = await endpoints.updateStatus(req.params.id, req.provider.id, "active");
    if (!updated) return res.status(404).json({ error: "Endpoint not found" });
    res.json({ endpoint: updated, message: "Endpoint is now live on the marketplace" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/me/endpoints/:id/suspend", async (req, res) => {
  try {
    const updated = await endpoints.updateStatus(req.params.id, req.provider.id, "suspended");
    if (!updated) return res.status(404).json({ error: "Endpoint not found" });
    res.json({ endpoint: updated, message: "Endpoint suspended" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Transactions & Analytics ─────────────────────────────────────────────────

router.get("/me/transactions", async (req, res) => {
  try {
    const txs = await providers.recentTransactions(req.provider.id, parseInt(req.query.limit || "50"));
    res.json({ transactions: txs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/payouts", async (req, res) => {
  try {
    const list = await payouts.listByProvider(req.provider.id);
    res.json({ payouts: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/analytics", async (req, res) => {
  try {
    const [timeSeries, topEndpoints_] = await Promise.all([
      transactions.callsTimeSeries(req.provider.id, parseInt(req.query.days || "30")),
      transactions.topEndpoints(req.provider.id, 5),
    ]);
    res.json({ timeSeries, topEndpoints: topEndpoints_ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
