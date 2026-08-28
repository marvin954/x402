# x402 Trading API Extension

This extension adds trading-specific endpoints to the MAMMBA x402 Marketplace API to support arbitrage agents and other trading applications.

## Overview

The x402 API now includes endpoints specifically designed for enabling programmable arbitrage and trading workflows through the x402 payment protocol.

## New Endpoints

### 1. Get Current Prices
```
GET /trading/prices
```

Returns current prices for major trading pairs sourced from CoinGecko.

**Response:**
```json
{
  "prices": {
    "USDC/ETH": 0.0005,      // 1 USDC = 0.0005 ETH
    "ETH/USDC": 1850.00,     // 1 ETH = 1850 USDC
    "USDC/BTC": 0.000015,    // 1 USDC = 0.000015 BTC
    "BTC/USDC": 65000.00,    // 1 BTC = 65000 USDC
    "USDC/USDT": 0.9998,     // 1 USDC ≈ 0.9998 USDT
    "USDT/USDC": 1.0002,     // 1 USDT ≈ 1.0002 USDC
    "USDC/DAI": 0.9995,      // 1 USDC ≈ 0.9995 DAI
    "DAI/USDC": 1.0005       // 1 DAI ≈ 1.0005 USDC
  }
}
```

### 2. Initiate Trade
```
POST /trading/trade
Content-Type: application/json

{
  "pair": "USDC/ETH",
  "side": "buy",
  "amount": 100
}
```

**Response (200 OK when payment processed):**
```json
{
  "success": true,
  "paymentId": "pay_abc123def456",
  "pair": "USDC/ETH",
  "side": "buy",
  "amount": 100,
  "price": 0.0005,
  "requiresPayment": false,
  "message": "Trade initiated. Use GET /trade/{paymentId}/complete?tx_hash={hash} to check completion.",
  "simulated": true
}
```

**Response (402 Payment Required when payment needed):**
- Returns standard x402 v2 402 response with PAYMENT-REQUIRED header
- Contains payment requirements in JSON format (base64 encoded in header)

### 3. Check Trade Completion
```
GET /trading/trade/{paymentId}/complete?tx_hash=0x...
```

**Response:**
```json
{
  "success": true,
  "paymentId": "pay_abc123def456",
  "txHash": "0x1234567890abcdef",
  "confirmed": true,
  "confirmations": 5,
  "completedAt": "2026-08-25T10:30:00Z",
  "message": "Trade completed successfully on blockchain"
}
```

## Integration with Arbitrage Agent

To use this API with the arbitrage agent in `/home/mammba/Documents/GitHub/x402marketplace/arbitrage-agent/`:

1. Deploy this x402 API to a publicly accessible URL (e.g., Vercel)
2. Copy `.env.example` to `.env` in the arbitrage agent directory
3. Set `API_BASE_URL` to point to your deployed API (e.g., `https://your-x402-api.vercel.app`)
4. Ensure other environment variables match your deployment:
   - `FACILITATOR_URL`
   - `NETWORK` 
   - `USDC_ASSET`
   - `PLATFORM_WALLET`
   - `SERVER_URL`
5. Run the arbitrage agent: `npm start`

## How It Works

1. **Price Discovery**: The arbitrage agent calls `GET /trading/prices` to get current market prices
2. **Opportunity Detection**: The agent identifies profitable arbitrage opportunities across trading pairs
3. **Trade Execution**: When an opportunity exceeds the profit threshold:
   - Agent calls `POST /trading/trade` with trade details
   - API returns 402 Payment Required if x402 payment is needed
   - Agent processes payment via x402 facilitator
   - API validates and settles payment
   - Agent receives trade initiation confirmation
4. **Verification**: Agent calls `GET /trading/trade/{paymentId}/complete?tx_hash={hash}` to verify blockchain confirmation

## x402 Payment Flow

All trade execution requests require x402 v2 payment:
1. Request without X-Payment header → 402 Payment Required
2. Request with X-Payment header → verify with facilitator
3. Payment valid → settle transaction
4. Compute revenue split (platform fee vs provider earnings)
5. Attach payment metadata to request for logging/auditing

## Dependencies

- Node.js 16.x or higher
- PostgreSQL database
- Connection to CoinGecko API for price data
- Access to x402 facilitator service
- Environment variables configured (see .env.example)

## Security

- Input validation on all endpoints
- Rate limiting inherited from base x402 API
- Payment validation via x402 facilitator
- No direct access to private keys or sensitive data
