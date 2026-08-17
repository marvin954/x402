# MAMMBA x402 Marketplace

> Multi-tenant API marketplace — developers publish paid endpoints, AI agents pay per request with USDC. Platform earns a configurable cut of every transaction.

```
Developer registers endpoint ($0.01/call)
         ↓
Client hits /proxy/:slug with X-Payment header
         ↓
Marketplace verifies + settles via Coinbase facilitator
         ↓
Proxy forwards to upstream → returns response
         ↓
Transaction recorded: $0.0085 → provider, $0.0015 → MAMMBA
```

---

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20 (ESM) |
| Framework | Express.js |
| Database | PostgreSQL 16 |
| Containers | Docker + Docker Compose |
| Payments | x402 v2 · USDC · Base |
| Facilitator | Coinbase (x402.xyz) |

---

## Quick Start

```bash
# 1. Clone & configure
git clone https://github.com/marvin954/mammba-x402-marketplace
cd mammba-x402-marketplace
cp .env.example .env
# Edit .env — at minimum set PLATFORM_WALLET, ADMIN_API_KEY, JWT_SECRET

# 2. Start (postgres auto-migrates on first boot)
make up

# 3. Seed demo data
make seed

# 4. Run tests
make test

# 5. Open pgAdmin (optional)
make dev
```

The API is live at **http://localhost:3000**

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PLATFORM_WALLET` | **Your Base wallet** — receives 100% of every x402 payment |
| `PLATFORM_FEE_PERCENT` | Your cut (default 15 = 15%, providers earn 85%) |
| `ADMIN_API_KEY` | Secret key for admin endpoints |
| `DATABASE_URL` | PostgreSQL connection string |
| `NETWORK` | `eip155:84532` (Base Sepolia) or `eip155:8453` (Base mainnet) |
| `USDC_ASSET` | USDC contract address for chosen network |
| `FACILITATOR_URL` | Coinbase x402 facilitator (default: `https://x402.xyz/facilitator`) |
| `SERVER_URL` | Your public URL (used in 402 responses) |

---

## API Reference

### Public (no auth)

```
GET  /                           Landing page + docs
GET  /health                     Healthcheck → { status: "ok" }
GET  /marketplace/endpoints      Browse active paid endpoints
GET  /marketplace/endpoints/:slug  Single endpoint + x402 schema
GET  /marketplace/categories     Available categories
GET  /marketplace/stats          Platform stats
```

### Provider (X-API-Key header)

```
POST /api/providers/register     Sign up, get API key
GET  /api/providers/me           Dashboard + earnings
PUT  /api/providers/me/wallet    Update payout wallet
POST /api/providers/me/rotate-key  Rotate API key

GET  /api/providers/me/endpoints        List my endpoints
POST /api/providers/me/endpoints        Register endpoint
PUT  /api/providers/me/endpoints/:id    Update endpoint
DEL  /api/providers/me/endpoints/:id    Delete endpoint
POST /api/providers/me/endpoints/:id/activate
POST /api/providers/me/endpoints/:id/suspend

GET  /api/providers/me/transactions  Payment history
GET  /api/providers/me/payouts       Payout history
GET  /api/providers/me/analytics     Time-series + top endpoints
```

### Paid Proxy (X-Payment header)

```
GET/POST/PUT/PATCH/DELETE /proxy/:slug
```

Returns the upstream provider's response. Without a valid x402 payment, returns HTTP 402 with full payment requirements.

### Admin (X-Admin-Key header)

```
GET  /admin/stats                    Platform revenue
GET  /admin/providers                All providers
POST /admin/providers/:id/suspend
POST /admin/providers/:id/activate

GET  /admin/endpoints?status=pending  Review queue
POST /admin/endpoints/:id/activate    Approve endpoint
POST /admin/endpoints/:id/suspend

GET  /admin/transactions             Recent transactions
GET  /admin/payouts/pending          Owed to providers
POST /admin/payouts/initiate         Create payout record
POST /admin/payouts/:id/complete     Mark paid (add tx hash)
POST /admin/payouts/:id/fail
```

---

## Provider Flow

### 1. Register

```bash
curl -X POST http://localhost:3000/api/providers/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Co",
    "email": "dev@myapi.io",
    "walletAddress": "0xYourBaseWallet"
  }'
# → { provider: { apiKey: "abc123...", ... } }
```

### 2. Register an Endpoint

```bash
curl -X POST http://localhost:3000/api/providers/me/endpoints \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Weather Data",
    "description": "Real-time weather for any city",
    "category": "data",
    "tags": ["weather", "realtime"],
    "upstreamUrl": "https://api.myweather.io/current",
    "method": "GET",
    "priceUsdc": "0.01"
  }'
# → { endpoint: { slug: "premium-weather-data", ... }, economics: { yourEarningsPerCall: 0.0085 } }
```

### 3. Admin Approves

```bash
curl -X POST http://localhost:3000/admin/endpoints/{id}/activate \
  -H "X-Admin-Key: your_admin_key"
```

### 4. Clients Call It

```bash
# Without payment → 402
curl http://localhost:3000/proxy/premium-weather-data
# → { x402Version: 2, accepts: [{ amount: "10000", payTo: "0xMAMBBA..." }] }

# With payment → proxied response
curl http://localhost:3000/proxy/premium-weather-data \
  -H "X-Payment: <base64-encoded-x402-payload>"
# → upstream weather data
```

---

## Revenue Model

Every settled x402 payment:

```
Gross payment: 0.0100 USDC
Platform fee (15%): 0.0015 USDC → MAMMBA wallet (instant, on-chain)
Provider share (85%): 0.0085 USDC → logged in transactions table

Weekly payout job:
  SELECT SUM(provider_cut) - total_paid_out FROM providers
  → Send USDC to each provider wallet
  → POST /admin/payouts/initiate
  → POST /admin/payouts/:id/complete  (add on-chain tx hash)
```

Platform fee is configured via `PLATFORM_FEE_PERCENT` — change it anytime.

---

## Database Schema

```
providers      - Developer accounts (name, email, wallet, api_key)
endpoints      - Registered paid APIs (slug, upstream_url, price_atomic, status)
transactions   - Immutable payment ledger (tx_hash, platform_cut, provider_cut)
payouts        - Disbursement records (pending → processing → completed)
```

Triggers auto-update denormalized counters (`total_calls`, `total_revenue`, `total_earned`) on every transaction insert — dashboard reads are instant, no aggregation queries at request time.

---

## Makefile Commands

```bash
make up        # Start postgres + api
make dev       # Also start pgAdmin at :5050
make down      # Stop services
make reset     # Stop + wipe database
make test      # Run test suite
make seed      # Load demo data
make psql      # Open postgres shell
make logs      # Tail API logs
make watch     # Watch paid proxy calls only
```

---

## Register on x402scan

Once deployed, submit any active endpoint URL:

```
https://your-marketplace.com/proxy/premium-weather-data
```

At **[x402scan.com/resources/register](https://x402scan.com/resources/register)** — it auto-validates the 402 schema and lists it.

---

Built by **MAMMBA Enterprises LLC** · x402 v2 Protocol
