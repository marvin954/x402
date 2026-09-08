/**
 * MAMMBA x402 Marketplace
 * Multi-tenant API marketplace with per-transaction revenue split
 */
import express from "express";
import cors from "cors";
import { waitForDB } from "./db/pool.js";
import 'dotenv/config';
import providersRouter   from "./routes/providers.js";
import marketplaceRouter from "./routes/marketplace.js";
import adminRouter       from "./routes/admin.js";
import seedRouter        from "./routes/seed.js";
import debugRouter       from "./routes/debug.js";
import intelligenceRouter from "./routes/intelligence.js";
import businessRouter   from "./routes/business-intelligence.js";
import aiGatewayRouter  from "./routes/ai-gateway.js";
import cryptoRouter     from "./routes/crypto-intelligence.js";
import workflowsRouter  from "./routes/workflows.js";
import { endpoints } from "./db/queries.js";

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: "*",
  exposedHeaders: ["X-PAYMENT-RESPONSE", "X-PAYMENT-REQUIRED", "X-Request-Id"],
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Request ID + basic logging
app.use((req, res, next) => {
  req.requestId = Math.random().toString(36).slice(2, 10);
  res.setHeader("X-Request-Id", req.requestId);
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const isPaid = !!req.headers["x-payment"];
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms${isPaid ? " 💳" : ""}`);
  });
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Serve favicon.ico / favicon.png / favicon.svg (discovery audit wants these)
const FAVICON_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlz" +
  "AAAAbwAAALsBIgSsdQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFCSURB" +
  "VDiNjZMxDsIwDEV/on/dBBcUNzcHEEBwO+BDc0FBRby7XYNsYXVQVFS0YFHQAtJDc0FBN5aCNiA/" +
  "tLWyzbatzZqZ7u5Rs6Xd6dzPvPfOfOd77rnPOXAO6wC+AhRQBvwEakABvwKPAf8Bd2PM7W+7+4F/" +
  "AFr2Br2S7tkBfMAX4Of/PgHcvQZen8ZePwV0AP7jv/fp81dfv3H3LoFGvP7NzEINfwnc/ysBYv8d" +
  "PqLP3wL9KrBL7gNeF5GLZRE7b1TA/xrYws4AXwN8/v8PABb+DcAvAb9y3inAAfCLfPW3+HB4eLN7" +
  "m6e32w9zgKsBpwMfAX4ETgNfAFPA/wOwrOFVUgI1+AAAAABJRU5ErkJggg==";
const FAVICON_PNG_BUFFER = Buffer.from(FAVICON_PNG, "base64");

app.get("/favicon.ico", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(FAVICON_PNG_BUFFER);
});

app.get("/favicon.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(FAVICON_PNG_BUFFER);
});

app.get("/favicon.svg", (req, res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1e1b4b"/><text x="16" y="24" font-family="system-ui" font-size="22" font-weight="700" fill="#818cf8" text-anchor="middle">M</text></svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(svg);
});

// ─── OpenAPI Discovery (required for x402scan) ────────────────────────────────
app.get("/openapi.json", async (req, res) => {
  try {
    console.log("[openapi.json] Request received");
    // Import and use the comprehensive OpenAPI generator
    const { generateOpenAPISpec } = await import("./openapi-generator.js");
    const spec = await generateOpenAPISpec();

    res.setHeader("Cache-Control", "no-store");
    res.json(spec);
  } catch (error) {
    console.error("[openapi.json] Error generating spec:", error.message);
    res.status(500).json({ error: "Failed to generate OpenAPI specification" });
  }
});
// ─── Well-known x402 discovery (alternative endpoint) ───────────────────────
app.get('/.well-known/x402', async (req, res) => {
  try {
    console.log("[openapi.json] Request received");
    const { generateOpenAPISpec } = await import("./openapi-generator.js");
    const spec = await generateOpenAPISpec();
    res.setHeader("Cache-Control", "no-store");
    res.json(spec);
  } catch (error) {
    console.error("[/.well-known/x402] Error generating spec:", error.message);
    res.status(500).json({ error: "Failed to generate OpenAPI specification" });
  }
});
// Health check (used by Docker healthcheck)
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

// Landing page
app.get("/", (req, res) => {
  const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>MAMMBA x402 Marketplace</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#08090d;color:#e2e8f0;min-height:100vh}
    .hero{max-width:960px;margin:0 auto;padding:80px 24px 48px;text-align:center}
    .badge{display:inline-flex;align-items:center;gap:8px;background:#131825;border:1px solid #1e2d45;border-radius:100px;padding:6px 18px;font-size:12px;color:#64748b;margin-bottom:28px}
    .badge .live{width:7px;height:7px;background:#10b981;border-radius:50%;animation:p 2s infinite}
    @keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
    h1{font-size:3rem;font-weight:800;background:linear-gradient(135deg,#818cf8,#c084fc,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px;line-height:1.1}
    .sub{color:#64748b;font-size:1.1rem;margin-bottom:60px;max-width:560px;margin-left:auto;margin-right:auto}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:60px;text-align:left}
    .card{background:#0f1117;border:1px solid #1a2235;border-radius:14px;padding:28px}
    .card h3{font-size:.85rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin-bottom:12px}
    .card p{color:#94a3b8;font-size:.9rem;line-height:1.6}
    .endpoints{max-width:960px;margin:0 auto;padding:0 24px 80px}
    .endpoints h2{font-size:1.3rem;font-weight:600;margin-bottom:20px;color:#c4b5fd}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{text-align:left;padding:10px 14px;color:#475569;font-weight:500;border-bottom:1px solid #1a2235;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
    td{padding:12px 14px;border-bottom:1px solid #0f1117;color:#94a3b8;font-family:monospace}
    td:first-child{color:#e2e8f0;font-family:inherit;font-weight:500}
    .method{font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:4px}
    .get{background:#1e3a5f;color:#93c5fd}
    .post{background:#14532d;color:#86efac}
    .free{background:#312e81;color:#a5b4fc}
    .highlight{color:#a78bfa;font-family:monospace;font-size:.8rem}
    @media(max-width:700px){.grid{grid-template-columns:1fr}h1{font-size:2rem}}
  </style>
</head>
<body>
<div class="hero">
  <div class="badge"><span class="live"></span> x402 Protocol · Base Network</div>
  <h1>MAMMBA x402 Marketplace</h1>
  <p class="sub">The multi-tenant API marketplace where developers publish paid endpoints and AI agents pay per request with USDC.</p>
  <div class="grid">
    <div class="card">
      <h3>For Developers</h3>
      <p>Register your API, set a USDC price, and get a marketplace URL. We handle all x402 payment logic — you just build the endpoint.</p>
    </div>
    <div class="card">
      <h3>For AI Agents</h3>
      <p>Browse <a href="/marketplace/endpoints" style="color:#818cf8">/marketplace/endpoints</a>. v2 agents send a <code>PAYMENT-SIGNATURE</code> header; v1 agents send <code>X-PAYMENT</code>. Access any listed API instantly.</p>
    </div>
    <div class="card">
      <h3>Revenue Split</h3>
      <p>${process.env.PLATFORM_FEE_PERCENT || 15}% platform fee on every transaction. Providers earn ${100 - parseInt(process.env.PLATFORM_FEE_PERCENT || 15)}%. Payouts in USDC on Base, weekly.</p>
    </div>
  </div>
</div>
<div class="endpoints">
  <h2>API Reference</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
    <tr><td>Discovery</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/marketplace/endpoints</td><td>—</td><td>Browse active paid endpoints</td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/marketplace/endpoints/:slug</td><td>—</td><td>Single endpoint detail + x402 schema</td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/marketplace/stats</td><td>—</td><td>Platform-wide stats</td></tr>
    <tr><td>Provider</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/providers/register</td><td>—</td><td>Create account, receive API key</td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/api/providers/me</td><td>X-API-Key</td><td>Dashboard + earnings summary</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/providers/me/endpoints</td><td>X-API-Key</td><td>Register a new paid endpoint</td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/api/providers/me/analytics</td><td>X-API-Key</td><td>Time-series calls + top endpoints</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/website/intelligence</td><td>—</td><td>Free website intelligence scraper — title, description, image, favicon, social links, contacts, technologies, content summary</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/business/intelligence</td><td>$0.25 (X-Payment / PAYMENT-SIGNATURE)</td><td>Full business intelligence — company info, website analysis, contacts, technologies, social profiles, AI lead score (0-100)</td></tr>
    <tr><td>AI Gateway (paid)</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/chat</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Chat completions — GPT-4o, Claude, Ollama (OpenAI-compatible API)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/embeddings</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Text embeddings — vector search, semantic similarity</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/image</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Image generation — DALL-E 3 and other image models</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/transcribe</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Audio transcription — Whisper and other speech-to-text models</td></tr>
    <tr><td>Crypto Intelligence (paid)</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/token-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Token fundamentals, price, market cap, volume, community links</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/wallet-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Wallet holdings, transactions, PnL estimate, smart-money labels</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/smart-money</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Top-performing traders, copy-trading signals, PnL + win rate</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/newpairs</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Freshly listed tokens across DEXs with liquidity + market cap filters</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/token-security</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Honeypot scan, mint/freeze authority, liquidity lock, holder concentration</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/v1/market-sentiment</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Fear &amp; greed index, trending tickers, social sentiment, top gainers/losers</td></tr>
    <tr><td>Workflow APIs (paid)</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/lead-research</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Lead research — find, score, and enrich businesses by industry + location ($2.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/website-audit</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Comprehensive website audit: SEO, CWV, technologies, accessibility, content, conversions ($5.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/sales-prospect</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Sales prospecting — find businesses, analyze, score, generate personalized outreach ($3.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/competitor-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Competitor analysis — analyze target, identify competitors, compare services &amp; positioning ($5.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/market-research</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Market research — industry demand, competitors, segments, trends, opportunities, risks ($5.00-$25.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/content-factory</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Content factory — hooks, scripts, captions, hashtags, CTAs, posting recommendations ($1.00-$10.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/seo-content</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>SEO content pipeline — keyword research, title, meta, article, FAQ, structured data ($3.00-$15.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/contact-enrichment</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Contact enrichment — company description, industry, services, location, public contacts ($2.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/reputation-check</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Reputation check — public review sentiment, strengths, issues, recommendations ($3.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/proposal-generator</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Proposal generator — executive summary, scope, deliverables, timeline, pricing, terms ($5.00-$25.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/business-blueprint</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Business blueprint — overview, customers, revenue model, competition, startup plan, 90-day action ($5.00-$20.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/document-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Document intelligence — extract text, summarize, key entities, dates, action items ($3.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/invoice-extract</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Invoice extraction — vendor, invoice #, dates, currency, subtotal, tax, total, line items ($2.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/contract-review</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Contract analysis — parties, obligations, dates, payment terms, clauses, legal questions ($5.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/deep-research</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Deep research — multi-step research plan, multi-source search, evidence synthesis, sources ($5.00-$50.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/due-diligence</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Business due diligence — company research, reputation, news, risks, strengths, verified labels ($5.00-$25.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/social-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Social media analysis — profile overview, content patterns, topics, engagement indicators ($3.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/candidate-analysis</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Candidate analysis — resume vs job description: skills match, experience, strengths, interview questions ($3.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/workflows/business-email</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Business email sequence — cold outreach, follow-ups, sales sequences, partnership, responses ($1.00-$10.00)</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/api/agent/execute</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>AI agent task executor — classify, plan, execute subtasks with controlled tool registry ($1.00-$25.00+)</td></tr>
    <tr><td>Proxy (paid)</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/proxy/:slug</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Call any listed GET endpoint</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/proxy/:slug</td><td>X-Payment (v1) / PAYMENT-SIGNATURE (v2)</td><td>Call any listed POST endpoint</td></tr>
    <tr><td>Admin</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/admin/stats</td><td>X-Admin-Key</td><td>Full platform revenue stats</td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/admin/payouts/pending</td><td>X-Admin-Key</td><td>Providers owed money</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/admin/endpoints/:id/activate</td><td>X-Admin-Key</td><td>Approve endpoint</td></tr>
  </table>
</div>
</body>
</html>`);
});

// Mount routers
app.use("/api/providers",   providersRouter);
app.use("/marketplace",     marketplaceRouter);
app.use("/proxy",           marketplaceRouter);   // /proxy/:slug lives in marketplace router
app.use("/admin",           adminRouter);
app.use("/debug", debugRouter);         // Debug routes
app.use("/v1", intelligenceRouter);    // POST /v1/website/intelligence
app.use("/v1", businessRouter);        // POST /v1/business/intelligence
app.use("/v1", aiGatewayRouter);       // POST /v1/chat, /v1/embeddings, /v1/image, /v1/transcribe
app.use("/v1", cryptoRouter);          // POST /v1/token-analysis, /v1/wallet-analysis, /v1/smart-money, /v1/newpairs, /v1/token-security, /v1/market-sentiment
app.use("/api/workflows", workflowsRouter); // POST /api/workflows/lead-research + future workflows
// app.use("/migrate", migrateRouter);     // Migration route (protected by token)
app.use("/seed", seedRouter);           // Seed route (protected by token)

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error("[app] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Boot ────────────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith("index.js");
const isVercel = process.env.VERCEL === '1';

if (isMain && !isVercel) {
  const PORT = process.env.PORT || 3000;
  try {
    await waitForDB();
    app.listen(PORT, "0.0.0.0", () => console.log(`MAMMBA x402 running on http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// For Vercel, we export the app and Vercel handles the listening
export default app;
