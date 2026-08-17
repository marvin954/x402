/**
 * Admin routes — requires X-Admin-Key header
 *
 * GET  /admin/stats                      - Platform revenue & stats
 * GET  /admin/providers                  - All providers
 * POST /admin/providers/:id/suspend      - Suspend provider
 * GET  /admin/endpoints                  - All pending endpoints (review queue)
 * POST /admin/endpoints/:id/activate     - Approve & activate
 * POST /admin/endpoints/:id/suspend      - Suspend endpoint
 * GET  /admin/transactions               - Recent transactions
 * GET  /admin/payouts/pending            - Providers owed money
 * POST /admin/payouts/initiate           - Create payout record (manual)
 * POST /admin/payouts/:id/complete       - Mark payout completed with tx hash
 */
import { Router } from "express";
import { admin, payouts, providers, endpoints } from "../db/queries.js";
import { requireAdmin } from "../middleware/auth.js";
import { query } from "../db/pool.js";

const router = Router();
router.use(requireAdmin);

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/stats", async (req, res) => {
  try {
    const stats = await admin.platformStats();
    res.json({
      platform: {
        totalProviders:    parseInt(stats.total_providers || 0),
        activeEndpoints:   parseInt(stats.active_endpoints || 0),
        totalTransactions: parseInt(stats.total_transactions || 0),
        totalVolumeUsdc:   parseFloat(stats.total_volume_usdc || 0),
        platformRevenueUsdc: parseFloat(stats.platform_revenue_usdc || 0),
        providerRevenueUsdc: parseFloat(stats.provider_revenue_usdc || 0),
        calls24h:          parseInt(stats.calls_24h || 0),
        uniquePayers:      parseInt(stats.unique_payers || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Providers ────────────────────────────────────────────────────────────────

router.get("/providers", async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || "50"), 500);
    const offset = parseInt(req.query.offset || "0");
    const list = await admin.allProviders(limit, offset);
    res.json({ providers: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/providers/:id/suspend", async (req, res) => {
  try {
    await admin.suspendProvider(req.params.id);
    res.json({ message: "Provider suspended" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/providers/:id/activate", async (req, res) => {
  try {
    await query(
      `UPDATE providers SET status='active', updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    res.json({ message: "Provider activated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Endpoint review queue ────────────────────────────────────────────────────

router.get("/endpoints", async (req, res) => {
  try {
    const statusFilter = req.query.status || "pending";
    const { rows } = await query(
      `SELECT e.*, p.name AS provider_name, p.email AS provider_email
       FROM endpoints e
       JOIN providers p ON p.id = e.provider_id
       WHERE e.status = $1
       ORDER BY e.created_at ASC`,
      [statusFilter]
    );
    res.json({ endpoints: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/endpoints/:id/activate", async (req, res) => {
  try {
    await admin.activateEndpoint(req.params.id);
    res.json({ message: "Endpoint activated and live on marketplace" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/endpoints/:id/suspend", async (req, res) => {
  try {
    await admin.suspendEndpoint(req.params.id);
    res.json({ message: "Endpoint suspended" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Transactions ─────────────────────────────────────────────────────────────

router.get("/transactions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100"), 1000);
    const list = await admin.recentTransactions(limit);
    res.json({ transactions: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Payouts ──────────────────────────────────────────────────────────────────

router.get("/payouts/pending", async (req, res) => {
  try {
    const pending = await payouts.pendingForAllProviders();
    const totalOwed = pending.reduce((s, p) => s + parseFloat(p.owed_usdc), 0);
    res.json({
      providers: pending,
      totalOwed: parseFloat(totalOwed.toFixed(6)),
      count: pending.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/payouts/initiate", async (req, res) => {
  try {
    const { providerId, note } = req.body;

    // Find provider and their owed amount
    const pendingList = await payouts.pendingForAllProviders();
    const providerData = providerId
      ? pendingList.find((p) => p.provider_id === providerId)
      : null;

    if (providerId && !providerData) {
      return res.status(404).json({ error: "Provider not found or no pending balance" });
    }

    // If no providerId → batch all
    const targets = providerId ? [providerData] : pendingList;

    const created = [];
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); // start of month

    for (const target of targets) {
      const payout = await payouts.create({
        providerId:    target.provider_id,
        walletAddress: target.wallet_address,
        amountUsdc:    parseFloat(target.owed_usdc),
        periodStart,
        periodEnd:     now,
        note:          note || "Manual payout initiated via admin",
      });
      created.push(payout);
    }

    res.status(201).json({
      message: `${created.length} payout(s) created — send USDC and call /complete with tx hash`,
      payouts: created,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/payouts/:id/complete", async (req, res) => {
  try {
    const { txHash } = req.body;
    if (!txHash) return res.status(400).json({ error: "txHash required" });

    // Fetch payout to get amount + provider
    const { rows } = await query(`SELECT * FROM payouts WHERE id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Payout not found" });

    const payout_row = rows[0];

    // Mark completed + update provider's total_paid_out
    const [completed] = await Promise.all([
      payouts.markCompleted(req.params.id, txHash),
      payouts.markProviderPaidOut(payout_row.provider_id, payout_row.amount_usdc),
    ]);

    res.json({ message: "Payout marked as completed", payout: completed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/payouts/:id/fail", async (req, res) => {
  try {
    const { note } = req.body;
    const failed = await payouts.markFailed(req.params.id, note || "Failed");
    res.json({ payout: failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
