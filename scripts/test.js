/**
 * End-to-end API test
 * Run against a live server: node scripts/test.js
 *
 * SERVER_URL=http://localhost:3000 node scripts/test.js
 * ADMIN_API_KEY=yoursecret node scripts/test.js
 */
import http from "http";
import https from "https";

const BASE = process.env.SERVER_URL || "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "admin_secret";

let pass = 0; let fail = 0;
let providerApiKey = null;
let endpointId = null;
let endpointSlug = null;

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function req(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const r = lib.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === "https:" ? 443 : 80),
        path:     url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }); }
          catch { resolve({ status: res.statusCode, body: d, headers: res.headers }); }
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function test(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    await fn();
    console.log("✅");
    pass++;
  } catch (e) {
    console.log(`❌  ${e.message}`);
    fail++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

// ─── Tests ────────────────────────────────────────────────────────────────────
console.log(`\n🧪  MAMMBA x402 Marketplace — Test Suite`);
console.log(`📡  ${BASE}\n`);

// Health
await test("GET /health → 200", async () => {
  const r = await req("GET", "/health");
  assert(r.status === 200, `Expected 200, got ${r.status}`);
  assert(r.body.status === "ok");
});

// Landing
await test("GET / → HTML", async () => {
  const r = await req("GET", "/");
  assert(r.status === 200);
});

// Marketplace discovery (empty at start)
await test("GET /marketplace/endpoints → 200 array", async () => {
  const r = await req("GET", "/marketplace/endpoints");
  assert(r.status === 200, `${r.status}`);
  assert(Array.isArray(r.body.endpoints));
});

await test("GET /marketplace/stats → 200", async () => {
  const r = await req("GET", "/marketplace/stats");
  assert(r.status === 200);
  assert(typeof r.body.totalProviders === "number");
});

// Provider registration
await test("POST /api/providers/register → 201 + apiKey", async () => {
  const r = await req("POST", "/api/providers/register", {
    body: {
      name: "Test Provider",
      email: `test_${Date.now()}@example.com`,
      walletAddress: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    },
  });
  assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.provider?.apiKey, "No apiKey returned");
  providerApiKey = r.body.provider.apiKey;
});

await test("POST /api/providers/register duplicate email → 409", async () => {
  await req("POST", "/api/providers/register", {
    body: { name: "Dup", email: "dupe@test.com", walletAddress: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" },
  });
  const r = await req("POST", "/api/providers/register", {
    body: { name: "Dup2", email: "dupe@test.com", walletAddress: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" },
  });
  assert(r.status === 409, `Expected 409, got ${r.status}`);
});

// Provider dashboard
await test("GET /api/providers/me with valid key → 200", async () => {
  const r = await req("GET", "/api/providers/me", { headers: { "X-API-Key": providerApiKey } });
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.stats);
});

await test("GET /api/providers/me without key → 401", async () => {
  const r = await req("GET", "/api/providers/me");
  assert(r.status === 401);
});

// Create endpoint
await test("POST /api/providers/me/endpoints → 201 + slug", async () => {
  const r = await req("POST", "/api/providers/me/endpoints", {
    headers: { "X-API-Key": providerApiKey },
    body: {
      name: "Test Echo API",
      description: "Returns whatever you send",
      category: "utilities",
      tags: ["echo", "test"],
      upstreamUrl: "https://httpbin.org/get",
      method: "GET",
      priceUsdc: "0.005",
    },
  });
  assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.endpoint?.slug, "No slug");
  endpointId   = r.body.endpoint.id;
  endpointSlug = r.body.endpoint.slug;
  assert(r.body.economics?.yourEarningsPerCall > 0, "No earnings shown");
});

await test("POST /api/providers/me/endpoints invalid price → 400", async () => {
  const r = await req("POST", "/api/providers/me/endpoints", {
    headers: { "X-API-Key": providerApiKey },
    body: { name: "Bad", upstreamUrl: "https://httpbin.org/get", priceUsdc: "0.000001" },
  });
  assert(r.status === 400, `Expected 400 got ${r.status}`);
});

// List endpoints (pending, not in marketplace yet)
await test("GET /api/providers/me/endpoints → array includes our endpoint", async () => {
  const r = await req("GET", "/api/providers/me/endpoints", { headers: { "X-API-Key": providerApiKey } });
  assert(r.status === 200);
  const found = r.body.endpoints.find((e) => e.id === endpointId);
  assert(found, "Endpoint not found in provider list");
  assert(found.status === "pending");
});

// x402 on pending endpoint → 503
await test("GET /proxy/:slug for pending endpoint → 503", async () => {
  const r = await req("GET", `/proxy/${endpointSlug}`);
  assert(r.status === 503, `Expected 503, got ${r.status}`);
});

// Admin: activate endpoint
await test("POST /admin/endpoints/:id/activate (admin) → 200", async () => {
  const r = await req("POST", `/admin/endpoints/${endpointId}/activate`, {
    headers: { "X-Admin-Key": ADMIN_KEY },
  });
  assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// x402 on active endpoint → 402 (no payment)
await test("GET /proxy/:slug active, no X-Payment → 402 with x402 schema", async () => {
  const r = await req("GET", `/proxy/${endpointSlug}`);
  assert(r.status === 402, `Expected 402, got ${r.status}`);
  assert(r.body.x402Version === 2, "Missing x402Version:2");
  assert(Array.isArray(r.body.accepts), "No accepts array");
  assert(r.body.accepts[0]?.scheme === "exact", "Wrong scheme");
  assert(r.body.accepts[0]?.amount, "No amount");
  assert(r.body.resource?.url, "No resource URL");
});

// Marketplace listing (now has our activated endpoint)
await test("GET /marketplace/endpoints includes activated endpoint", async () => {
  const r = await req("GET", "/marketplace/endpoints");
  assert(r.status === 200);
  const found = r.body.endpoints.find((e) => e.slug === endpointSlug);
  assert(found, "Activated endpoint not in marketplace listing");
});

// Endpoint detail page
await test("GET /marketplace/endpoints/:slug → full detail + x402 fields", async () => {
  const r = await req("GET", `/marketplace/endpoints/${endpointSlug}`);
  assert(r.status === 200);
  assert(r.body.x402?.scheme === "exact");
  assert(r.body.x402?.amount);
  assert(r.body.proxyUrl?.includes("/proxy/"));
});

// Suspend + unsuspend
await test("POST .../suspend → endpoint 503", async () => {
  await req("POST", `/api/providers/me/endpoints/${endpointId}/suspend`, { headers: { "X-API-Key": providerApiKey } });
  const r = await req("GET", `/proxy/${endpointSlug}`);
  assert(r.status === 503);
});

await test("POST .../activate (provider) → endpoint back to 402", async () => {
  await req("POST", `/api/providers/me/endpoints/${endpointId}/activate`, { headers: { "X-API-Key": providerApiKey } });
  const r = await req("GET", `/proxy/${endpointSlug}`);
  assert(r.status === 402);
});

// Admin stats
await test("GET /admin/stats → platform revenue object", async () => {
  const r = await req("GET", "/admin/stats", { headers: { "X-Admin-Key": ADMIN_KEY } });
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body)}`);
  assert(typeof r.body.platform?.totalProviders === "number");
});

await test("GET /admin/stats wrong key → 403", async () => {
  const r = await req("GET", "/admin/stats", { headers: { "X-Admin-Key": "wrong" } });
  assert(r.status === 403);
});

// Analytics
await test("GET /api/providers/me/analytics → timeSeries + topEndpoints", async () => {
  const r = await req("GET", "/api/providers/me/analytics", { headers: { "X-API-Key": providerApiKey } });
  assert(r.status === 200);
  assert(Array.isArray(r.body.timeSeries));
  assert(Array.isArray(r.body.topEndpoints));
});

// Categories
await test("GET /marketplace/categories → array", async () => {
  const r = await req("GET", "/marketplace/categories");
  assert(r.status === 200);
  assert(Array.isArray(r.body.categories));
});

// Key rotation
await test("POST /api/providers/me/rotate-key → new key", async () => {
  const r = await req("POST", "/api/providers/me/rotate-key", { headers: { "X-API-Key": providerApiKey } });
  assert(r.status === 200);
  assert(r.body.apiKey && r.body.apiKey !== providerApiKey, "Key should have changed");
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Results: ${pass} passed  ${fail} failed  (${pass + fail} total)\n`);

if (fail === 0) {
  console.log("✅ All tests passed — marketplace is fully operational\n");
  console.log("📋 Register on x402scan:");
  console.log(`   Submit: ${BASE}/proxy/${endpointSlug || "<slug>"}`);
  console.log(`   Docs:   https://x402scan.com/resources/register\n`);
} else {
  console.log("⚠️  Some tests failed — check server logs\n");
  process.exit(1);
}
