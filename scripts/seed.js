/**
 * Seed script — populates the DB with demo providers + endpoints
 * Run: DATABASE_URL=postgres://... node scripts/seed.js
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const DEMO_PROVIDERS = [
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
        upstreamUrl: "https://wttr.in/?format=j1",
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
        upstreamUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd",
        method: "GET",
        priceAtomic: 3000,
      },
      {
        slug: "exchange-rates",
        name: "FX Exchange Rates",
        description: "Live foreign exchange rates for 170+ currencies.",
        category: "finance",
        tags: ["forex", "currency", "exchange"],
        upstreamUrl: "https://open.er-api.com/v6/latest/USD",
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
        upstreamUrl: "https://ipinfo.io/json",
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
        method: "GET",
        priceAtomic: 1000,
      },
    ],
  },
  // ── BimBAA MAMMBA Workflows ────────────────────────────────────────────────
  {
    name: "BimBAA MAMMBA Workflows",
    email: "info@bimmbaent.com",
    wallet: "0xD4B508FBA121a7A8D3211e54e15bE967B457d6F9",
    endpoints: [
      {
        slug: "lead-research",
        name: "Lead Research",
        description: "Search for businesses by industry + location, enrich with website/contact scraping, score leads, and generate outreach opportunities. $2.00 per call.",
        category: "lead-generation",
        tags: ["lead-generation", "research", "sales", "scraping", "scoring", "outreach", "business"],
        upstreamUrl: "/api/workflows/lead-research",
        method: "POST",
        priceAtomic: 2000000,
      },
      {
        slug: "website-audit",
        name: "Website Audit",
        description: "Comprehensive website audit: SEO, core web vitals, technology detection, accessibility, content analysis, and conversion opportunities. $5.00 per audit.",
        category: "seo",
        tags: ["seo", "website", "audit", "performance", "technology", "accessibility", "core-web-vitals", "marketing"],
        upstreamUrl: "/api/workflows/website-audit",
        method: "POST",
        priceAtomic: 5000000,
      },
      {
        slug: "sales-prospect",
        name: "Sales Prospecting",
        description: "Find businesses by industry + location, research each company, identify pain points, score prospects, and generate personalized outreach messages. $3.00 per call.",
        category: "sales",
        tags: ["sales", "prospecting", "lead-generation", "outreach", "scoring", "pain-points", "business"],
        upstreamUrl: "/api/workflows/sales-prospect",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "competitor-analysis",
        name: "Competitor Analysis",
        description: "Analyze a target business, identify competitors, research their websites, compare services and positioning, and identify market opportunities and threats. $5.00 per call.",
        category: "research",
        tags: ["research", "competitor", "analysis", "market", "seo", "positioning", "strategy", "business"],
        upstreamUrl: "/api/workflows/competitor-analysis",
        method: "POST",
        priceAtomic: 5000000,
      },
      {
        slug: "market-research",
        name: "Market Research",
        description: "Research an industry in a location: market demand, competitors, customer segments, trends, opportunities, risks, and strategic recommendations. $5.00 per call.",
        category: "research",
        tags: ["research", "market", "industry", "demand", "competition", "trends", "strategy", "business"],
        upstreamUrl: "/api/workflows/market-research",
        method: "POST",
        priceAtomic: 5000000,
      },
      {
        slug: "content-factory",
        name: "Content Factory",
        description: "Generate social media content at scale: hooks, content ideas, scripts, captions, hashtag suggestions, CTAs, and posting recommendations. $3.00 per call.",
        category: "content-generation",
        tags: ["content", "social-media", "tiktok", "instagram", "twitter", "linkedin", "youtube", "marketing", "generation"],
        upstreamUrl: "/api/workflows/content-factory",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "seo-content",
        name: "SEO Content Pipeline",
        description: "Generate SEO-optimized content: keyword research context, title options, meta descriptions, article content, heading structure, FAQ section, and structured data recommendations. $5.00 per call.",
        category: "seo",
        tags: ["seo", "content", "keyword", "article", "meta-description", "faq", "structured-data", "marketing"],
        upstreamUrl: "/api/workflows/seo-content",
        method: "POST",
        priceAtomic: 5000000,
      },
      {
        slug: "contact-enrichment",
        name: "Contact Enrichment",
        description: "Enrich a company with publicly available information: description, industry, services, location, and public business contact info. $2.00 per call.",
        category: "business-intelligence",
        tags: ["business-intelligence", "enrichment", "company", "contact", "research", "b2b", "data"],
        upstreamUrl: "/api/workflows/contact-enrichment",
        method: "POST",
        priceAtomic: 2000000,
      },
      {
        slug: "reputation-check",
        name: "Reputation Check",
        description: "Analyze publicly available reputation signals: review sentiment, strengths, issues, and recommendations. Only analyzes public data. $3.00 per call.",
        category: "reputation",
        tags: ["reputation", "reviews", "sentiment", "analysis", "brand", "social-proof", "research"],
        upstreamUrl: "/api/workflows/reputation-check",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "proposal-generator",
        name: "Proposal Generator",
        description: "Generate a structured business proposal: executive summary, scope of work, deliverables, timeline, pricing framework, terms suggestions, and next steps. $10.00 per proposal.",
        category: "business",
        tags: ["proposal", "business", "sales", "b2b", "document", "generation", "professional-services"],
        upstreamUrl: "/api/workflows/proposal-generator",
        method: "POST",
        priceAtomic: 10000000,
      },
      {
        slug: "business-blueprint",
        name: "Business Blueprint",
        description: "Generate a comprehensive business blueprint: overview, target customers, revenue model, services, competitive landscape, startup requirements, pricing, marketing, sales, operations, and 90-day action plan. $10.00 per blueprint.",
        category: "business",
        tags: ["business", "plan", "strategy", "startup", "blueprint", "business-plan", "entrepreneur", "guidance"],
        upstreamUrl: "/api/workflows/business-blueprint",
        method: "POST",
        priceAtomic: 10000000,
      },
      {
        slug: "document-analysis",
        name: "Document Intelligence",
        description: "Extract text from uploaded documents (PDF, text, invoices, business docs), summarize, identify key entities, important dates, and action items. $3.00 per document.",
        category: "document-processing",
        tags: ["document", "pdf", "text", "analysis", "extraction", "summarization", "entities", "dates", "action-items"],
        upstreamUrl: "/api/workflows/document-analysis",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "invoice-extract",
        name: "Invoice Extraction",
        description: "Extract structured invoice data: vendor, invoice number, dates, currency, subtotal, tax, total, and line items. $2.00 per invoice.",
        category: "document-processing",
        tags: ["invoice", "extraction", "ocr", "document", "finance", "accounting", "data-extraction", "receipt"],
        upstreamUrl: "/api/workflows/invoice-extract",
        method: "POST",
        priceAtomic: 2000000,
      },
      {
        slug: "contract-review",
        name: "Contract Analysis",
        description: "Analyze contracts: summarize, identify parties, obligations, dates, payment terms, termination terms, and important clauses. INFORMATIONAL ONLY. $5.00 per document.",
        category: "document-processing",
        tags: ["contract", "legal", "analysis", "review", "documents", "compliance", "risk", "obligations"],
        upstreamUrl: "/api/workflows/contract-review",
        method: "POST",
        priceAtomic: 5000000,
      },
      {
        slug: "deep-research",
        name: "Deep Research",
        description: "Multi-step research workflow: creates a research plan, searches multiple sources, gathers evidence, cross-checks information, and generates findings with sources. $10.00 per research.",
        category: "research",
        tags: ["research", "deep-research", "analysis", "synthesis", "evidence", "sources", "multi-step", "intelligence"],
        upstreamUrl: "/api/workflows/deep-research",
        method: "POST",
        priceAtomic: 10000000,
      },
      {
        slug: "due-diligence",
        name: "Business Due Diligence",
        description: "Research a company + website, analyze public reputation, news, competitors, identify risks and positive indicators, and generate a due diligence summary. $10.00 per report.",
        category: "business-intelligence",
        tags: ["due-diligence", "research", "risk", "reputation", "analysis", "business", "verification", "assessment"],
        upstreamUrl: "/api/workflows/due-diligence",
        method: "POST",
        priceAtomic: 10000000,
      },
      {
        slug: "social-analysis",
        name: "Social Media Analysis",
        description: "Analyze publicly accessible social media profile data: profile overview, content patterns, topic analysis, engagement indicators, competitor opportunities, and content recommendations. $3.00 per profile.",
        category: "social-media",
        tags: ["social-media", "analysis", "profile", "content", "engagement", "research", "public-data", "instagram", "twitter", "linkedin", "tiktok"],
        upstreamUrl: "/api/workflows/social-analysis",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "candidate-analysis",
        name: "Candidate Analysis",
        description: "Analyze a resume against a job description. Returns skills match, experience assessment, strengths, missing qualifications, and suggested interview questions. $3.00 per analysis.",
        category: "hr",
        tags: ["hr", "candidate", "resume", "job-description", "hiring", "skills-match", "interview", "analysis"],
        upstreamUrl: "/api/workflows/candidate-analysis",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "business-email",
        name: "Business Email Sequence",
        description: "Generate business email content: cold outreach, follow-ups, sales sequences, partnership outreach, customer responses, networking, thank you, and breakup emails. $3.00 per call.",
        category: "communication",
        tags: ["email", "business", "outreach", "communication", "sales", "follow-up", "sequence", "copywriting"],
        upstreamUrl: "/api/workflows/business-email",
        method: "POST",
        priceAtomic: 3000000,
      },
      {
        slug: "ai-agent-execute",
        name: "AI Agent Task Executor",
        description: "Takes a natural-language task, classifies it, estimates complexity, plans and executes subtasks using a controlled tool registry, and returns a structured result. $3.00 per task.",
        category: "ai-agent",
        tags: ["ai-agent", "task-execution", "automation", "agent", "orchestration", "tool-use", "complex-tasks", "intelligence"],
        upstreamUrl: "/api/agent/execute",
        method: "POST",
        priceAtomic: 3000000,
      },
    ],
  },
];

async function seed() {
  console.log("🌱  Seeding database...\n");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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

        await client.query(
          `INSERT INTO endpoints
             (provider_id, slug, name, description, category, tags, upstream_url, method, price_atomic, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')`,
          [provider.id, ep.slug, ep.name, ep.description, ep.category,
           ep.tags, ep.upstreamUrl, ep.method, ep.priceAtomic]
        );
        console.log(`    · Endpoint: ${ep.name} → /proxy/${ep.slug} (${ep.priceAtomic/1e6} USDC)`);
      }
    }

    await client.query("COMMIT");
    console.log("\n✅  Seed complete\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
