/**
 * Trading API (for arbitrage agents)
 *
 * GET  /prices          - Get current prices for trading pairs
 * POST  /trade          - Initiate a trade (returns 402 Payment Required)
 * GET  /trade/:id/complete - Check trade completion on blockchain
 */
import { Router } from "express";
import { requirePayment } from "../middleware/x402.js";
import https from "https";

const router = Router();

// ─── Get Current Prices ───────────────────────────────────────────────────────

/**
 * GET /prices
 * Returns current prices for trading pairs used by arbitrage agent
 */
router.get("/prices", async (req, res) => {
  try {
    // Return hardcoded prices for testing
    const prices = {
      "USDC/ETH": 0.05,
      "ETH/USDC": 20,
      "USDC/BTC": 0.000002,
      "BTC/USDC": 50000,
      "USDC/USDT": 1,
      "USDT/USDC": 1,
      "USDC/DAI": 1,
      "DAI/USDC": 1
    };

    res.json({ prices });
  } catch (err) {
    console.error('[/prices] Error fetching prices:', err.message);
    res.status(500).json({ error: 'Failed to fetch price data' });
  }
});

// ─── Trade Execution ──────────────────────────────────────────────────────────

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
    
    // Create a mock endpoint for the x402 payment flow
    const slug = `trade-${Math.random().toString(36).substring(2, 9)}`;

    const mockEndpoint = {
      slug,
      name: `Trade Execution: ${pair}`,
      description: `Execute ${side.toUpperCase()} ${amount} ${pair} trade`,
      price_atomic: Math.round(serviceFeeUsdc * 1_000_000), // Convert to atomic units
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

// ─── Trade Completion Check ───────────────────────────────────────────────────

/**
 * GET /trade/:paymentId/complete?tx_hash={hash}
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

export default router;
