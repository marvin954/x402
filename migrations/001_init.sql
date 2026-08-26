-- ============================================================
--  x402 Marketplace — Database Schema
--  Runs automatically on first `docker compose up`
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- disabled for non-superuser

-- ─── ENUMs ───────────────────────────────────────────────────────────────────

CREATE TYPE endpoint_status  AS ENUM ('pending', 'active', 'suspended', 'deleted');
CREATE TYPE endpoint_method  AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
CREATE TYPE payout_status    AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE provider_status  AS ENUM ('active', 'suspended');

-- ─── providers ───────────────────────────────────────────────────────────────
-- One row per registered developer

CREATE TABLE providers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    email           TEXT        NOT NULL UNIQUE,
    wallet_address  TEXT        NOT NULL,          -- Base wallet for USDC payouts
    api_key         TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    status          provider_status NOT NULL DEFAULT 'active',
    total_earned    NUMERIC(18,6)   NOT NULL DEFAULT 0,  -- cumulative gross (before fee)
    total_paid_out  NUMERIC(18,6)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_providers_api_key ON providers(api_key);
CREATE INDEX idx_providers_email   ON providers(email);

-- ─── endpoints ───────────────────────────────────────────────────────────────
-- Each row is one paid API slot on the marketplace

CREATE TABLE endpoints (
    id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id      UUID            NOT NULL REFERENCES providers(id) ON DELETE CASCADE,

    -- Marketplace identity
    slug             TEXT            NOT NULL UNIQUE,   -- /proxy/{slug}
    name             TEXT            NOT NULL,
    description      TEXT            NOT NULL DEFAULT '',
    category         TEXT            NOT NULL DEFAULT 'general',
    tags             TEXT[]          NOT NULL DEFAULT '{}',

    -- Proxy target
    upstream_url     TEXT            NOT NULL,          -- e.g. https://api.provider.io/data
    method           endpoint_method NOT NULL DEFAULT 'GET',

    -- x402 pricing (stored in USDC atomic units, 6 decimals)
    -- e.g. $0.01 = 10000
    price_atomic     BIGINT          NOT NULL,
    price_display    TEXT            GENERATED ALWAYS AS (
                         '$' || ROUND(price_atomic::NUMERIC / 1000000, 4)::TEXT || ' USDC'
                     ) STORED,

    -- Optional: fixed upstream auth header the provider supplies
    -- encrypted at rest — see src/lib/crypto.js
    upstream_auth_header  TEXT,   -- encrypted value of "Authorization: Bearer ..."

    -- Stats (denormalized counters, updated on each transaction)
    total_calls      BIGINT          NOT NULL DEFAULT 0,
    total_revenue    NUMERIC(18,6)   NOT NULL DEFAULT 0,  -- gross USDC

    status           endpoint_status NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_endpoints_provider  ON endpoints(provider_id);
CREATE INDEX idx_endpoints_slug      ON endpoints(slug);
CREATE INDEX idx_endpoints_status    ON endpoints(status);
CREATE INDEX idx_endpoints_category  ON endpoints(category);

-- ─── transactions ─────────────────────────────────────────────────────────────
-- Immutable ledger — one row per settled x402 payment

CREATE TABLE transactions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id      UUID        NOT NULL REFERENCES endpoints(id),
    provider_id      UUID        NOT NULL REFERENCES providers(id),

    -- x402 settlement data
    tx_hash          TEXT        NOT NULL,           -- on-chain tx hash
    network          TEXT        NOT NULL,           -- eip155:8453 etc.
    payer_address    TEXT        NOT NULL,           -- client's wallet
    amount_atomic    BIGINT      NOT NULL,           -- total paid (atomic USDC)

    -- Revenue split
    platform_fee_pct NUMERIC(5,2) NOT NULL,          -- e.g. 15.00
    platform_cut     NUMERIC(18,6) NOT NULL,          -- USDC going to MAMMBA
    provider_cut     NUMERIC(18,6) NOT NULL,          -- USDC owed to provider

    -- Request metadata (for analytics)
    request_method   TEXT,
    request_path     TEXT,
    request_ip       TEXT,
    upstream_status  INT,                            -- HTTP status from provider
    response_time_ms INT,                            -- end-to-end latency

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_endpoint   ON transactions(endpoint_id);
CREATE INDEX idx_transactions_provider   ON transactions(provider_id);
CREATE INDEX idx_transactions_tx_hash    ON transactions(tx_hash);
CREATE INDEX idx_transactions_payer      ON transactions(payer_address);
CREATE INDEX idx_transactions_created    ON transactions(created_at DESC);

-- ─── payouts ──────────────────────────────────────────────────────────────────
-- Tracks disbursements from MAMMBA wallet → provider wallets

CREATE TABLE payouts (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id      UUID         NOT NULL REFERENCES providers(id),
    wallet_address   TEXT         NOT NULL,   -- snapshot of wallet at payout time
    amount_usdc      NUMERIC(18,6) NOT NULL,
    tx_hash          TEXT,                    -- filled after on-chain send
    status           payout_status NOT NULL DEFAULT 'pending',
    note             TEXT,
    period_start     TIMESTAMPTZ  NOT NULL,
    period_end       TIMESTAMPTZ  NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX idx_payouts_provider ON payouts(provider_id);
CREATE INDEX idx_payouts_status   ON payouts(status);

-- ─── Triggers: keep updated_at fresh ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_providers_updated_at
    BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_endpoints_updated_at
    BEFORE UPDATE ON endpoints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Trigger: update denormalized counters on new transaction ─────────────────

CREATE OR REPLACE FUNCTION after_transaction_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- bump endpoint counters
    UPDATE endpoints
       SET total_calls   = total_calls + 1,
           total_revenue = total_revenue + (NEW.amount_atomic::NUMERIC / 1000000)
     WHERE id = NEW.endpoint_id;

    -- bump provider lifetime earnings
    UPDATE providers
       SET total_earned = total_earned + (NEW.provider_cut)
     WHERE id = NEW.provider_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_after_transaction
    AFTER INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION after_transaction_insert();

-- ─── Views ────────────────────────────────────────────────────────────────────

-- Provider dashboard summary
CREATE VIEW v_provider_dashboard AS
SELECT
    p.id,
    p.name,
    p.email,
    p.wallet_address,
    p.status,
    COUNT(DISTINCT e.id)                           AS endpoint_count,
    COALESCE(SUM(t.provider_cut), 0)               AS total_earned_usdc,
    COALESCE(SUM(t.amount_atomic::NUMERIC/1000000), 0) AS total_gross_usdc,
    COUNT(t.id)                                    AS total_calls,
    p.total_paid_out,
    COALESCE(SUM(t.provider_cut), 0) - p.total_paid_out AS balance_pending,
    p.created_at
FROM providers p
LEFT JOIN endpoints  e ON e.provider_id = p.id AND e.status != 'deleted'
LEFT JOIN transactions t ON t.provider_id = p.id
GROUP BY p.id;

-- Marketplace public listing
CREATE VIEW v_marketplace_listing AS
SELECT
    e.id,
    e.slug,
    e.name,
    e.description,
    e.category,
    e.tags,
    e.method,
    e.price_atomic,
    e.price_display,
    e.total_calls,
    e.total_revenue,
    e.created_at,
    p.name AS provider_name
FROM endpoints e
JOIN providers p ON p.id = e.provider_id
WHERE e.status = 'active'
  AND p.status = 'active';

-- Platform admin stats
CREATE VIEW v_platform_stats AS
SELECT
    COUNT(DISTINCT p.id)                                AS total_providers,
    COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'active') AS active_endpoints,
    COUNT(t.id)                                         AS total_transactions,
    COALESCE(SUM(t.platform_cut), 0)                    AS platform_revenue_usdc,
    COALESCE(SUM(t.provider_cut), 0)                    AS provider_revenue_usdc,
    COALESCE(SUM(t.amount_atomic::NUMERIC / 1000000), 0) AS total_volume_usdc,
    COUNT(t.id) FILTER (WHERE t.created_at > NOW() - INTERVAL '24 hours') AS calls_24h,
    COUNT(DISTINCT t.payer_address)                     AS unique_payers
FROM providers p
LEFT JOIN endpoints    e ON e.provider_id = p.id
LEFT JOIN transactions t ON t.endpoint_id = e.id;
