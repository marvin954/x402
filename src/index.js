/**
 * MAMMBA x402 Marketplace
 * Multi-tenant API marketplace with per-transaction revenue split
 */
import express from "express";
import cors from "cors";
import { waitForDB } from "./db/pool.js";
import providersRouter   from "./routes/providers.js";
import marketplaceRouter from "./routes/marketplace.js";
import adminRouter       from "./routes/admin.js";
import { endpoints } from "./db/queries.js";
import { endpointContract } from "./lib/openapi-contract.js";

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: "*",
  exposedHeaders: ["X-Payment-Response", "X-Request-Id"],
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
// Serve favicon.ico
app.get("/favicon.ico", (req, res) => {
  res.status(204).end(); // No content, but prevents 404 logs
});

// ─── OpenAPI Discovery (required for x402scan) ────────────────────────────────
app.get("/openapi.json", async (req, res) => {
  const SERVER_URL = (process.env.SERVER_URL || "https://x402-sage.vercel.app").replace(/\/+$/, "");
  const NETWORK    = process.env.NETWORK    || "eip155:84532";
  const USDC_ASSET = process.env.USDC_ASSET || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const PAY_TO     = process.env.PLATFORM_WALLET || "";

  let activeEndpoints = [];
  try { activeEndpoints = await endpoints.listMarketplace({ limit: 100 }); } catch {}

  const paths = {};
  for (const ep of activeEndpoints) {
    const method = ep.method.toLowerCase();
    const priceUsd = (ep.price_atomic / 1_000_000).toFixed(6);
    const contract = endpointContract(ep);

    // Build the 402 Payment Required response schema based on x402 v2 spec
    const paymentRequiredSchema = {
      type: "object",
      required: ["x402Version", "error", "resource", "accepts"],
      properties: {
        x402Version: { type: "integer", enum: [2] },
        error: { type: "string" },
        resource: {
          type: "object",
          required: ["url", "description", "mimeType"],
          properties: {
            url: { type: "string", format: "uri" },
            description: { type: "string" },
            mimeType: { type: "string" }
          }
        },
        accepts: {
          type: "array",
          items: {
            type: "object",
            required: ["scheme", "network", "amount", "asset", "payTo"],
            properties: {
              scheme: { type: "string", enum: ["exact"] },
              network: { type: "string" },
              amount: { type: "string" },
              asset: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              payTo: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              maxTimeoutSeconds: { type: "integer", minimum: 1 },
              extra: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  version: { type: "string" }
                }
              }
            }
          }
        },
        extensions: {
          type: "object",
          properties: {
            marketplace: {
              type: "object",
              properties: {
                info: {
                  type: "object",
                  properties: {
                    platform: { type: "string" },
                    endpointSlug: { type: "string" },
                    providerName: { type: "string" }
                  }
                },
                schema: {
                  type: "object",
                  properties: {
                    platform: { type: "string" },
                    endpointSlug: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    };

    paths[`/proxy/${ep.slug}`] = {
      [method]: {
        operationId: ep.slug.replace(/-/g, "_"),
        summary: ep.name,
        description: ep.description || ep.name,
        tags: ep.tags?.length ? ep.tags : [ep.category],
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: priceUsd },
          protocols: [{ x402: { network: NETWORK, asset: USDC_ASSET, payTo: PAY_TO, maxTimeoutSeconds: 60 } }],
        },
        parameters: contract.queryParameters.length ? contract.queryParameters : (method === "get" ? [{ name: "q", in: "query", required: false, schema: { type: "string" }, description: "Optional query forwarded to upstream (ignored by demo endpoints)" }] : []),
        ...(contract.requestBodySchema ? {
          requestBody: {
            required: ep.method !== "GET",
            content: { "application/json": { schema: contract.requestBodySchema } }
          }
        } : {}),
        responses: {
          "200": {
            description: "Upstream provider response",
            content: { "application/json": { schema: contract.responseSchema } }
          },
          "402": {
            description: "Payment Required — include X-Payment header",
            headers: {
              "PAYMENT-REQUIRED": {
                description: "Base64-encoded x402 v2 PaymentRequired JSON object.",
                required: true,
                schema: { type: "string", contentEncoding: "base64", contentMediaType: "application/json" }
              }
            },
            content: { "application/json": { schema: paymentRequiredSchema } }
          }
        },
      },
      extensions: {
        bazaar: {
          schema: {
            properties: {
              input: contract.requestBodySchema || GENERIC_JSON_OBJECT,
              output: contract.responseSchema || GENERIC_JSON_OBJECT,
            }
          }
        }
      },
    };
  }

  // Add marketplace endpoints (free, no payment required)
  paths["/marketplace/endpoints"] = {
    get: {
      summary: "Browse active paid endpoints",
      description: "Returns a paginated list of all active endpoints in the marketplace.",
      operationId: "browseEndpoints",
      tags: ["marketplace"],
      parameters: [
        { name: "category", in: "query", required: false, schema: { type: "string" }, description: "Filter by category" },
        { name: "search", in: "query", required: false, schema: { type: "string" }, description: "Search term to match against name or description" },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 }, default: 20, description: "Number of results to return" },
        { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 }, default: 0, description: "Offset for pagination" }
      ],
      responses: {
        "200": {
          description: "Successful response with paginated endpoints",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  endpoints: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        slug: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string" },
                        category: { type: "string" },
                        tags: { type: "array", items: { type: "string" } },
                        method: { type: "string" },
                        priceAtomic: { type: "integer" },
                        priceDisplay: { type: "string" },
                        totalCalls: { type: "integer" },
                        provider: { type: "string" },
                        proxyUrl: { type: "string" },
                        createdAt: { type: "string", format: "date-time" }
                      },
                      required: ["id", "slug", "name", "method", "priceAtomic"]
                    }
                  },
                  pagination: {
                    type: "object",
                    properties: {
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      hasMore: { type: "boolean" }
                    },
                    required: ["total", "limit", "offset", "hasMore"]
                  }
                },
                required: ["endpoints", "pagination"]
              }
            }
          }
        },
        "500": { description: "Internal server error" }
      },
      security: [] // No authentication required
    }
  };

  paths["/marketplace/endpoints/{slug}"] = {
    get: {
      summary: "Get endpoint details",
      description: "Returns detailed information about a specific endpoint including its x402 payment requirements.",
      operationId: "getEndpointDetail",
      tags: ["marketplace"],
      parameters: [
        { name: "slug", in: "path", required: true, schema: { type: "string" }, description: "The endpoint slug" }
      ],
      responses: {
        "200": {
          description: "Successful response with endpoint details",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  slug: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  category: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                  method: { type: "string" },
                  priceAtomic: { type: "integer" },
                  priceDisplay: { type: "string" },
                  totalCalls: { type: "integer" },
                  provider: { type: "string" },
                  proxyUrl: { type: "string" },
                  x402: {
                    type: "object",
                    properties: {
                      scheme: { type: "string" },
                      network: { type: "string" },
                      asset: { type: "string" },
                      amount: { type: "string" },
                      payTo: { type: "string" },
                      maxTimeoutSeconds: { type: "integer" }
                    },
                    required: ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds"]
                  },
                  recentActivity: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        payerMasked: { type: "string" },
                        at: { type: "string", format: "date-time" },
                        upstreamStatus: { type: "integer" },
                        responseTimeMs: { type: "integer" }
                      }
                    }
                  },
                  createdAt: { type: "string", format: "date-time" }
                },
                required: ["id", "slug", "name", "method", "priceAtomic", "x402"]
              }
            }
          }
        },
        "404": { description: "Endpoint not found" },
        "500": { description: "Internal server error" }
      },
      security: [] // No authentication required
    }
  };

  paths["/marketplace/categories"] = {
    get: {
      summary: "Get available categories",
      description: "Returns a list of all unique categories used by endpoints in the marketplace.",
      operationId: "getCategories",
      tags: ["marketplace"],
      responses: {
        "200": {
          description: "Successful response with categories list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  categories: {
                    type: "array",
                    items: { type: "string" }
                  }
                },
                required: ["categories"]
              }
            }
          }
        },
        "500": { description: "Internal server error" }
      },
      security: [] // No authentication required
    }
  };

  paths["/marketplace/stats"] = {
    get: {
      summary: "Get platform statistics",
      description: "Returns platform-wide statistics about transactions, providers, and endpoints.",
      operationId: "getPlatformStats",
      tags: ["marketplace"],
      responses: {
        "200": {
          description: "Successful response with platform statistics",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  totalProviders: { type: "integer" },
                  activeEndpoints: { type: "integer" },
                  totalTransactions: { type: "integer" },
                  totalVolumeUsdc: { type: "number", format: "double" },
                  calls24h: { type: "integer" },
                  uniquePayers: { type: "integer" }
                },
                required: ["totalProviders", "activeEndpoints", "totalTransactions", "totalVolumeUsdc", "calls24h", "uniquePayers"]
              }
            }
          }
        },
        "500": { description: "Internal server error" }
      },
      security: [] // No authentication required
    }
  };

  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    openapi: "3.1.0",
    info: {
      title: "MAMMBA x402 Marketplace",
      version: "1.0.0",
      description: "Multi-tenant API marketplace — pay per request with USDC on Base.",
      contact: {
        email: "info@mammbaent.com" // Add contact email for verification
      },
      "x-guidance": `Pay-per-request marketplace. GET /proxy/{slug} without X-Payment to see requirements. Sign USDC transfer on ${NETWORK} to ${PAY_TO}, base64-encode, send as X-Payment header. Browse endpoints at ${SERVER_URL}/marketplace/endpoints`,
    },
    servers: [{ url: SERVER_URL }],
    paths,
    "x-x402": { version: 2, network: NETWORK, asset: USDC_ASSET, payTo: PAY_TO, facilitator: process.env.FACILITATOR_URL || "https://x402.xyz/facilitator" },
  });
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
  <div class="badge"><span class="live"></span> x402 Protocol v2 · Base Network</div>
  <h1>MAMMBA x402 Marketplace</h1>
  <p class="sub">The multi-tenant API marketplace where developers publish paid endpoints and AI agents pay per request with USDC.</p>
  <div class="grid">
    <div class="card">
      <h3>For Developers</h3>
      <p>Register your API, set a USDC price, and get a marketplace URL. We handle all x402 payment logic — you just build the endpoint.</p>
    </div>
    <div class="card">
      <h3>For AI Agents</h3>
      <p>Browse <a href="/marketplace/endpoints" style="color:#818cf8">/marketplace/endpoints</a>, send an X-Payment header with your USDC authorization, and access any listed API instantly.</p>
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
    <tr><td>Proxy (paid)</td><td></td><td></td><td></td></tr>
    <tr><td><span class="method get">GET</span></td><td class="highlight">/proxy/:slug</td><td>X-Payment</td><td>Call any listed GET endpoint</td></tr>
    <tr><td><span class="method post">POST</span></td><td class="highlight">/proxy/:slug</td><td>X-Payment</td><td>Call any listed POST endpoint</td></tr>
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
if (isMain) {
  const PORT = process.env.PORT || 3000;
  try { await waitForDB(); } catch (err) { console.error(err.message); process.exit(1); }
  app.listen(PORT, "0.0.0.0", () => console.log(`MAMMBA x402 running on http://0.0.0.0:${PORT}`));
}

export default app;