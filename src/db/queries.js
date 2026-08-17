/**
 * All database queries — one place, no SQL scattered across route handlers
 */
import { query, transaction } from "./pool.js";

// ─── Providers ────────────────────────────────────────────────────────────────

export const providers = {
  async create({ name, email, walletAddress }) {
    const { rows } = await query(
      `INSERT INTO providers (name, email, wallet_address)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, wallet_address, api_key, status, created_at`,
      [name, email, walletAddress]
    );
    return rows[0];
  },

  async findByApiKey(apiKey) {
    const { rows } = await query(
      `SELECT * FROM providers WHERE api_key = $1 AND status = 'active'`,
      [apiKey]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await query(
      `SELECT * FROM providers WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByEmail(email) {
    const { rows } = await query(
      `SELECT * FROM providers WHERE email = $1`,
      [email]
    );
    return rows[0] || null;
  },

  async dashboard(providerId) {
    const { rows } = await query(
      `SELECT * FROM v_provider_dashboard WHERE id = $1`,
      [providerId]
    );
    return rows[0] || null;
  },

  async recentTransactions(providerId, limit = 20) {
    const { rows } = await query(
      `SELECT t.*, e.name AS endpoint_name, e.slug
       FROM transactions t
       JOIN endpoints e ON e.id = t.endpoint_id
       WHERE t.provider_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [providerId, limit]
    );
    return rows;
  },

  async rotateApiKey(providerId) {
    const { rows } = await query(
      `UPDATE providers
       SET api_key = encode(gen_random_bytes(32), 'hex'), updated_at = NOW()
       WHERE id = $1
       RETURNING api_key`,
      [providerId]
    );
    return rows[0]?.api_key || null;
  },

  async updateWallet(providerId, walletAddress) {
    const { rows } = await query(
      `UPDATE providers SET wallet_address = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [providerId, walletAddress]
    );
    return rows[0] || null;
  },
};

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const endpoints = {
  async create({ providerId, slug, name, description, category, tags, upstreamUrl, method, priceAtomic, upstreamAuthHeader }) {
    const { rows } = await query(
      `INSERT INTO endpoints
         (provider_id, slug, name, description, category, tags, upstream_url, method, price_atomic, upstream_auth_header)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [providerId, slug, name, description, category, tags, upstreamUrl, method, priceAtomic, upstreamAuthHeader || null]
    );
    return rows[0];
  },

  async findBySlug(slug) {
    const { rows } = await query(
      `SELECT e.*, p.wallet_address AS provider_wallet, p.name AS provider_name, p.status AS provider_status
       FROM endpoints e
       JOIN providers p ON p.id = e.provider_id
       WHERE e.slug = $1`,
      [slug]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await query(`SELECT * FROM endpoints WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async listByProvider(providerId) {
    const { rows } = await query(
      `SELECT * FROM endpoints WHERE provider_id = $1 AND status != 'deleted' ORDER BY created_at DESC`,
      [providerId]
    );
    return rows;
  },

  async listMarketplace({ category, search, limit = 20, offset = 0 } = {}) {
    let where = [];
    let params = [];
    let i = 1;

    if (category && category !== "all") {
      where.push(`category = $${i++}`);
      params.push(category);
    }
    if (search) {
      where.push(`(name ILIKE $${i} OR description ILIKE $${i} OR $${i} = ANY(tags))`);
      params.push(`%${search}%`);
      i++;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);

    const { rows } = await query(
      `SELECT *, COUNT(*) OVER() AS total_count
       FROM v_marketplace_listing
       ${whereClause}
       ORDER BY total_calls DESC, created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );
    return rows;
  },

  async updateStatus(id, providerId, status) {
    const { rows } = await query(
      `UPDATE endpoints SET status = $3, updated_at = NOW()
       WHERE id = $1 AND provider_id = $2
       RETURNING *`,
      [id, providerId, status]
    );
    return rows[0] || null;
  },

  async update(id, providerId, fields) {
    const allowed = ["name", "description", "category", "tags", "price_atomic", "upstream_url", "upstream_auth_header"];
    const sets = [];
    const vals = [];
    let i = 1;

    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return null;
    vals.push(id, providerId);

    const { rows } = await query(
      `UPDATE endpoints SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${i} AND provider_id = $${i + 1}
       RETURNING *`,
      vals
    );
    return rows[0] || null;
  },

  async slugExists(slug) {
    const { rows } = await query(
      `SELECT 1 FROM endpoints WHERE slug = $1`,
      [slug]
    );
    return rows.length > 0;
  },

  async categories() {
    const { rows } = await query(
      `SELECT category, COUNT(*) AS count
       FROM endpoints WHERE status = 'active'
       GROUP BY category ORDER BY count DESC`
    );
    return rows;
  },
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactions = {
  async record({
    endpointId, providerId, txHash, network, payerAddress,
    amountAtomic, platformFeePct, platformCut, providerCut,
    requestMethod, requestPath, requestIp, upstreamStatus, responseTimeMs,
  }) {
    const { rows } = await query(
      `INSERT INTO transactions
         (endpoint_id, provider_id, tx_hash, network, payer_address,
          amount_atomic, platform_fee_pct, platform_cut, provider_cut,
          request_method, request_path, request_ip, upstream_status, response_time_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        endpointId, providerId, txHash, network, payerAddress,
        amountAtomic, platformFeePct, platformCut, providerCut,
        requestMethod, requestPath, requestIp, upstreamStatus, responseTimeMs,
      ]
    );
    return rows[0];
  },

  async listByEndpoint(endpointId, limit = 50) {
    const { rows } = await query(
      `SELECT * FROM transactions WHERE endpoint_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [endpointId, limit]
    );
    return rows;
  },

  async platformStats() {
    const { rows } = await query(`SELECT * FROM v_platform_stats`);
    return rows[0] || {};
  },

  async callsTimeSeries(providerId, days = 30) {
    const { rows } = await query(
      `SELECT DATE_TRUNC('day', t.created_at) AS day,
              COUNT(*)                        AS calls,
              SUM(t.provider_cut)             AS earned_usdc
       FROM transactions t
       WHERE t.provider_id = $1
         AND t.created_at > NOW() - ($2 || ' days')::INTERVAL
       GROUP BY 1 ORDER BY 1 ASC`,
      [providerId, days]
    );
    return rows;
  },

  async topEndpoints(providerId, limit = 5) {
    const { rows } = await query(
      `SELECT e.slug, e.name, COUNT(t.id) AS calls, SUM(t.provider_cut) AS earned
       FROM transactions t
       JOIN endpoints e ON e.id = t.endpoint_id
       WHERE t.provider_id = $1
       GROUP BY e.id ORDER BY calls DESC LIMIT $2`,
      [providerId, limit]
    );
    return rows;
  },
};

// ─── Payouts ──────────────────────────────────────────────────────────────────

export const payouts = {
  async create({ providerId, walletAddress, amountUsdc, periodStart, periodEnd, note }) {
    const { rows } = await query(
      `INSERT INTO payouts (provider_id, wallet_address, amount_usdc, period_start, period_end, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [providerId, walletAddress, amountUsdc, periodStart, periodEnd, note || null]
    );
    return rows[0];
  },

  async markCompleted(id, txHash) {
    const { rows } = await query(
      `UPDATE payouts SET status='completed', tx_hash=$2, completed_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, txHash]
    );
    return rows[0];
  },

  async markFailed(id, note) {
    const { rows } = await query(
      `UPDATE payouts SET status='failed', note=$2 WHERE id=$1 RETURNING *`,
      [id, note]
    );
    return rows[0];
  },

  async listByProvider(providerId) {
    const { rows } = await query(
      `SELECT * FROM payouts WHERE provider_id = $1 ORDER BY created_at DESC`,
      [providerId]
    );
    return rows;
  },

  async pendingForAllProviders() {
    // Aggregate unpaid earnings per provider
    const { rows } = await query(
      `SELECT
          p.id AS provider_id,
          p.name,
          p.wallet_address,
          SUM(t.provider_cut) - p.total_paid_out AS owed_usdc
       FROM providers p
       JOIN transactions t ON t.provider_id = p.id
       WHERE p.status = 'active'
       GROUP BY p.id
       HAVING SUM(t.provider_cut) - p.total_paid_out > 0.01
       ORDER BY owed_usdc DESC`
    );
    return rows;
  },

  async markProviderPaidOut(providerId, amount) {
    await query(
      `UPDATE providers SET total_paid_out = total_paid_out + $2, updated_at = NOW()
       WHERE id = $1`,
      [providerId, amount]
    );
  },
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const admin = {
  async platformStats() {
    const { rows } = await query(`SELECT * FROM v_platform_stats`);
    return rows[0];
  },

  async allProviders(limit = 100, offset = 0) {
    const { rows } = await query(
      `SELECT * FROM v_provider_dashboard ORDER BY total_calls DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async suspendProvider(id) {
    await query(`UPDATE providers SET status='suspended', updated_at=NOW() WHERE id=$1`, [id]);
  },

  async suspendEndpoint(id) {
    await query(`UPDATE endpoints SET status='suspended', updated_at=NOW() WHERE id=$1`, [id]);
  },

  async activateEndpoint(id) {
    await query(`UPDATE endpoints SET status='active', updated_at=NOW() WHERE id=$1`, [id]);
  },

  async recentTransactions(limit = 100) {
    const { rows } = await query(
      `SELECT t.*, e.slug, e.name AS endpoint_name, p.name AS provider_name
       FROM transactions t
       JOIN endpoints e ON e.id = t.endpoint_id
       JOIN providers p ON p.id = t.provider_id
       ORDER BY t.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  },
};
