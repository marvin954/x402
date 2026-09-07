import express from "express";
import pg from "pg";

const router = express.Router();

function getConnectionString() {
  // Construct connection string from individual POSTGRES variables if needed
  let connectionString = process.env.storage_DATABASE_URL || process.env.DATABASE_URL || process.env.x4_DATABASE_URL;

  // If we have individual POSTGRES variables but no DATABASE_URL, construct it
  if (!connectionString &&
      process.env.POSTGRES_USER &&
      process.env.POSTGRES_PASSWORD &&
      process.env.POSTGRES_DB) {
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    connectionString = `postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${host}:${port}/${process.env.POSTGRES_DB}`;
    console.log('[seed] Constructed connectionString from POSTGRES vars:', connectionString);
  }

  if (!connectionString) {
    console.log('[seed] No connection string found. Env vars:');
    console.log('[seed]   storage_DATABASE_URL:', !!process.env.storage_DATABASE_URL);
    console.log('[seed]   DATABASE_URL:', !!process.env.DATABASE_URL);
    console.log('[seed]   x4_DATABASE_URL:', !!process.env.x4_DATABASE_URL);
    console.log('[seed]   POSTGRES_USER:', !!process.env.POSTGRES_USER);
    console.log('[seed]   POSTGRES_PASSWORD:', !!process.env.POSTGRES_PASSWORD);
    console.log('[seed]   POSTGRES_DB:', !!process.env.POSTGRES_DB);
    throw new Error("DATABASE_URL is not set in Vercel env vars.");
  }

  return connectionString;
}

router.get("/", async (req, res) => {
  // Check for the seed token in the query string or header
  const token = req.query.token || req.headers["x-seed-token"];
  const expectedToken = process.env.SEED_TOKEN;

  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const pool = new pg.Pool({ connectionString: getConnectionString() });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const DEMO_PROVIDERS = [
        {
          name: "MAMMBA Entertainment",
          email: "info@mammbaent.com",
          wallet: "0xD4B508FBA121a7A8D3211e54e15bE967B457d6F9",
          endpoints: [
            {
              slug: "random-joke",
              name: "Random Joke",
              description: "A random joke — setup + punchline. Great for social media engagement.",
              category: "entertainment",
              tags: ["joke", "humor", "content"],
              upstreamUrl: "https://official-joke-api.appspot.com/random_joke",
              queryParameters: [],
              method: "GET",
              priceAtomic: 5000,
            },
            {
              slug: "random-meme",
              name: "Random Meme Concept",
              description: "A meme concept description for content inspiration.",
              category: "entertainment",
              tags: ["meme", "humor", "content"],
              upstreamUrl: "https://x402-sage.vercel.app/proxy/http-echo",
              queryParameters: ["q"],
              method: "GET",
              priceAtomic: 10000,
            },
            {
              slug: "inspirational-quote",
              name: "Inspirational Quote",
              description: "A random inspirational quote with author. Perfect for quote cards.",
              category: "entertainment",
              tags: ["quote", "inspiration", "content"],
              upstreamUrl: "https://api.quotable.io/random",
              queryParameters: [],
              method: "GET",
              priceAtomic: 5000,
            },
          ],
        },
        {
          name: "MAMMBA Utilities",
          email: "info@mammbaent.com",
          wallet: "0xD4B508FBA121a7A8D3211e54e15bE967B457d6F9",
          endpoints: [
            {
              slug: "qr-code",
              name: "QR Code Generator",
              description: "Generate a QR code image from any text or URL. Returns PNG.",
              category: "media",
              tags: ["qr", "image", "encoding", "mobile"],
              upstreamUrl: "https://api.qrserver.com/v1/create-qr-code/",
              queryParameters: ["data", "size", "color", "bgcolor", "format"],
              method: "GET",
              priceAtomic: 2000,
            },
            {
              slug: "website-intelligence",
              name: "Website Intelligence",
              description: "Scrape any URL and return structured intelligence: title, description, image, favicon, social_links, contacts, technologies, content_summary.",
              category: "data",
              tags: ["intelligence", "scraping", "website", "metadata", "content"],
              upstreamUrl: "/v1/website/intelligence",
              method: "POST",
              priceAtomic: 100000,
            },
            {
              slug: "business-intelligence",
              name: "Business Intelligence",
              description: "Full business report: company info, website analysis, contact extraction, technology detection, social profiles, and AI lead score (0-100). $0.25 per call.",
              category: "data",
              tags: ["intelligence", "business", "lead", "scoring", "contacts", "technology", "enrichment"],
              upstreamUrl: "/v1/business/intelligence",
              method: "POST",
              priceAtomic: 250000,
            },
            {
              slug: "ai-chat",
              name: "AI Chat",
              description: "Chat with an AI model — OpenAI GPT-4o, Anthropic Claude, or local Ollama. OpenAI-compatible API.",
              category: "ai",
              tags: ["ai", "chat", "gpt", "claude", "llm", "completion"],
              upstreamUrl: "/v1/chat",
              method: "POST",
              priceAtomic: 50000,
            },
            {
              slug: "ai-embeddings",
              name: "AI Embeddings",
              description: "Convert text to vector embeddings for semantic search. OpenAI text-embedding-3 or local Ollama.",
              category: "ai",
              tags: ["ai", "embeddings", "vector", "semantic", "search"],
              upstreamUrl: "/v1/embeddings",
              method: "POST",
              priceAtomic: 10000,
            },
            {
              slug: "ai-image",
              name: "AI Image Generation",
              description: "Generate images from text prompts using DALL-E 3 or other image models.",
              category: "ai",
              tags: ["ai", "image", "dalle", "generation", "creative"],
              upstreamUrl: "/v1/image",
              method: "POST",
              priceAtomic: 250000,
            },
            {
              slug: "ai-transcribe",
              name: "AI Transcription",
              description: "Transcribe audio files to text using Whisper. Upload audio as Buffer or data URI.",
              category: "ai",
              tags: ["ai", "transcription", "audio", "whisper", "speech"],
              upstreamUrl: "/v1/transcribe",
              method: "POST",
              priceAtomic: 100000,
            },
            {
              slug: "mock-user",
              name: "Mock User Generator",
              description: "Generate realistic fake user profiles — name, email, address, phone, avatar. Great for testing.",
              category: "data",
              tags: ["fake", "mock", "user", "testing", "demo"],
              upstreamUrl: "https://randomuser.me/api/",
              queryParameters: ["nat", "gender", "seed"],
              method: "GET",
              priceAtomic: 2000,
            },
            {
              slug: "timezone",
              name: "Timezone Lookup",
              description: "Look up timezone by area/city name. Returns timezone name, UTC offset, current time.",
              category: "data",
              tags: ["time", "timezone", "date", "schedule"],
              upstreamUrl: "https://timeapi.io/api/timezone/",
              queryParameters: ["area"],
              method: "GET",
              priceAtomic: 1000,
            },
          ],
        },
        {
          name: "WeatherAPI Pro",
          email: "weather@demo.io",
          wallet: "0x1111111111111111111111111111111111111111",
          endpoints: [
            {
              slug: "weather-current",
              name: "Current Weather",
              description: "Real-time weather data for any city. Returns temp, humidity, wind, and conditions.",
              category: "data",
              tags: ["weather", "iot", "realtime"],
              upstreamUrl: "https://wttr.in/",
              queryParameters: ["format"],
              method: "GET",
              priceAtomic: 5000,
            },
          ],
        },
        {
          name: "FinData Labs",
          email: "findata@demo.io",
          wallet: "0x2222222222222222222222222222222222222222",
          endpoints: [
            {
              slug: "crypto-prices",
              name: "Crypto Price Feed",
              description: "Live BTC, ETH, SOL prices via CoinGecko. Sub-cent per call.",
              category: "finance",
              tags: ["crypto", "prices", "defi"],
              upstreamUrl: "https://api.coingecko.com/api/v3/simple/price",
              queryParameters: ["ids", "vs_currencies"],
              method: "GET",
              priceAtomic: 3000,
            },
            {
              slug: "exchange-rates",
              name: "FX Exchange Rates",
              description: "Live foreign exchange rates for 170+ currencies.",
              category: "finance",
              tags: ["forex", "currency", "exchange"],
              upstreamUrl: "https://open.er-api.com/v6/latest",
              queryParameters: ["base"],
              method: "GET",
              priceAtomic: 2000,
            },
          ],
        },
        {
          name: "DevUtils",
          email: "devutils@demo.io",
          wallet: "0x3333333333333333333333333333333333333333",
          endpoints: [
            {
              slug: "ip-geolocation",
              name: "IP Geolocation",
              description: "Geolocate any IP address — country, city, ISP, timezone.",
              category: "utilities",
              tags: ["ip", "geo", "security"],
              upstreamUrl: "https://ipinfo.io/",
              queryParameters: ["ip"],
              method: "GET",
              priceAtomic: 4000,
            },
            {
              slug: "http-echo",
              name: "HTTP Echo",
              description: "Returns your request headers, body, and params back as JSON. Great for agent testing.",
              category: "utilities",
              tags: ["echo", "debug", "testing"],
              upstreamUrl: "https://httpbin.org/get",
              queryParameters: ["q"],
              method: "GET",
              priceAtomic: 1000,
            },
          ],
        },
        {
          name: "MAMMBA Crypto Intelligence",
          email: "crypto@mammbaent.com",
          wallet: "0xD4B508FBA121a7A8D3211e54e15bE967B457d6F9",
          endpoints: [
            {
              slug: "token-analysis",
              name: "Token Analysis",
              description: "Token fundamentals, price, market cap, volume, holders, and community links. $0.05 per call.",
              category: "crypto",
              tags: ["crypto", "token", "price", "market-cap", "volume", "defi", "analysis"],
              upstreamUrl: "/v1/token-analysis",
              method: "POST",
              priceAtomic: 50000,
            },
            {
              slug: "wallet-analysis",
              name: "Wallet Analysis",
              description: "Wallet holdings, transactions, PnL estimate, and smart-money labels. $0.10 per call.",
              category: "crypto",
              tags: ["crypto", "wallet", "holdings", "pnl", "transactions", "label", "defi"],
              upstreamUrl: "/v1/wallet-analysis",
              method: "POST",
              priceAtomic: 100000,
            },
            {
              slug: "smart-money",
              name: "Smart Money",
              description: "Top-performing traders, copy-trading signals, PnL, and win rates. $0.10 per call.",
              category: "crypto",
              tags: ["crypto", "trading", "smart-money", "pnl", "signals", "defi", "alpha"],
              upstreamUrl: "/v1/smart-money",
              method: "POST",
              priceAtomic: 100000,
            },
            {
              slug: "newpairs",
              name: "New Pairs",
              description: "Freshly listed tokens across DEXs with liquidity and market cap filters. $0.05 per call.",
              category: "crypto",
              tags: ["crypto", "tokens", "listing", "dex", "discovery", "defi", "alpha"],
              upstreamUrl: "/v1/newpairs",
              method: "POST",
              priceAtomic: 50000,
            },
            {
              slug: "token-security",
              name: "Token Security",
              description: "Honeypot scan, mint/freeze authority, liquidity lock, holder concentration. $0.10 per call.",
              category: "crypto",
              tags: ["crypto", "security", "honeypot", "audit", "safety", "defi", "risk"],
              upstreamUrl: "/v1/token-security",
              method: "POST",
              priceAtomic: 100000,
            },
            {
              slug: "market-sentiment",
              name: "Market Sentiment",
              description: "Fear & greed index, trending tickers, social sentiment, top gainers/losers. $0.02 per call.",
              category: "crypto",
              tags: ["crypto", "sentiment", "fear-greed", "trending", "social", "news", "market"],
              upstreamUrl: "/v1/market-sentiment",
              method: "POST",
              priceAtomic: 20000,
            },
          ],
        },
      ];

      for (const p of DEMO_PROVIDERS) {
        // Upsert provider
        const { rows: [provider] } = await client.query(
          `INSERT INTO providers (name, email, wallet_address)
           VALUES ($1,$2,$3)
           ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
           RETURNING id, api_key`,
          [p.name, p.email, p.wallet]
        );

        console.log(`  ✓ Provider: ${p.name} (key: ${provider.api_key.slice(0,12)}...)`);

        for (const ep of p.endpoints) {
          // Check slug doesn't exist
          const { rows: existing } = await client.query(
            `SELECT id FROM endpoints WHERE slug=$1`, [ep.slug]
          );
          if (existing.length) {
            console.log(`    · Endpoint '${ep.slug}' already exists — skipping`);
            continue;
          }

          console.log(`Seeding endpoint ${ep.slug} with queryParameters:`, ep.queryParameters);
          console.log(`  Type of queryParameters:`, typeof ep.queryParameters);
          console.log(`  Is Array:`, Array.isArray(ep.queryParameters));
          await client.query(
            `INSERT INTO endpoints
               (provider_id, slug, name, description, category, tags, upstream_url, method, price_atomic,
                upstream_auth_header, query_parameters, request_body_schema, response_schema, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')`,
            [provider.id, ep.slug, ep.name, ep.description, ep.category,
             ep.tags, ep.upstreamUrl, ep.method, ep.priceAtomic,
             null /* upstream_auth_header */, JSON.stringify(ep.queryParameters) /* query_parameters (JSONB) */, null /* request_body_schema */, '{}' /* response_schema */]
          );
          console.log(`    · Endpoint: ${ep.name} → /proxy/${ep.slug} (${ep.priceAtomic/1e6} USDC)`);
        }
      }

      await client.query("COMMIT");
      res.json({ status: "success", message: "Database seeded successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.error("[seed] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;