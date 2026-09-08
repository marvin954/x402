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
        {
          name: "MAMMBA Workflows",
          email: "info@mammbaent.com",
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
              queryParameters: [
                { name: "industry", type: "string", required: true, description: "Industry to search (e.g. roofing, HVAC, plumbing)" },
                { name: "location", type: "string", required: true, description: "Location to search (e.g. Miami, Florida)" },
                { name: "count", type: "integer", required: false, description: "Number of leads to return (1-100, default 20)" },
              ],
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
              queryParameters: [
                { name: "url", type: "string", required: true, description: "Website URL to audit (must be HTTPS)" },
              ],
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
              queryParameters: [
                { name: "industry", type: "string", required: true, description: "Industry to prospect (e.g. HVAC, roofing, plumbing)" },
                { name: "location", type: "string", required: true, description: "Location to prospect (e.g. South Florida)" },
                { name: "count", type: "integer", required: false, description: "Number of prospects to return (1-200, default 25)" },
              ],
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
              queryParameters: [
                { name: "business_url", type: "string", required: false, description: "URL of the target business to analyze" },
                { name: "business_name", type: "string", required: false, description: "Name of the target business (if URL not provided)" },
                { name: "competitor_count", type: "integer", required: false, description: "Number of competitors to research (1-20, default 5)" },
              ],
            },
            {
              slug: "market-research",
              name: "Market Research",
              description: "Research an industry in a location: market demand, competitors, customer segments, trends, opportunities, risks, and strategic recommendations. Supports basic/standard/premium depth. $5.00-$25.00.",
              category: "research",
              tags: ["research", "market", "industry", "demand", "competition", "trends", "strategy", "business"],
              upstreamUrl: "/api/workflows/market-research",
              method: "POST",
              priceAtomic: 5000000,
              queryParameters: [
                { name: "industry", type: "string", required: true, description: "Industry to research (e.g. medical courier, roofing)" },
                { name: "location", type: "string", required: false, description: "Location for the market research" },
                { name: "depth", type: "string", required: false, description: "Research depth: basic, standard, or premium (default standard)" },
              ],
            },
            {
              slug: "content-factory",
              name: "Content Factory",
              description: "Generate social media content at scale: hooks, content ideas, scripts, captions, hashtag suggestions, CTAs, and posting recommendations. Supports TikTok, Instagram, Twitter, LinkedIn, YouTube Shorts, and Facebook. $1.00-$10.00.",
              category: "content-generation",
              tags: ["content", "social-media", "tiktok", "instagram", "twitter", "linkedin", "youtube", "marketing", "generation"],
              upstreamUrl: "/api/workflows/content-factory",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "topic", type: "string", required: true, description: "Content topic (e.g. real estate investing, roofing tips)" },
                { name: "platform", type: "string", required: false, description: "Target platform: tiktok, instagram, twitter, linkedin, youtube_shorts, facebook, multi" },
                { name: "quantity", type: "integer", required: false, description: "Number of content items to generate" },
                { name: "package", type: "string", required: false, description: "Package: small (1-5), medium (6-20), large (21-50)" },
              ],
            },
            {
              slug: "seo-content",
              name: "SEO Content Pipeline",
              description: "Generate SEO-optimized content: keyword research context, title options, meta descriptions, article content, heading structure, FAQ section, and structured data recommendations. $3.00-$15.00.",
              category: "seo",
              tags: ["seo", "content", "keyword", "article", "meta-description", "faq", "structured-data", "marketing"],
              upstreamUrl: "/api/workflows/seo-content",
              method: "POST",
              priceAtomic: 5000000,
              queryParameters: [
                { name: "keyword", type: "string", required: true, description: "Target keyword for SEO content (e.g. Miami moving company)" },
                { name: "content_length", type: "integer", required: false, description: "Target article length in words (200-5000, default 2000)" },
                { name: "tone", type: "string", required: false, description: "Content tone: informative, professional, conversational, authoritative" },
                { name: "include_faq", type: "boolean", required: false, description: "Include FAQ section (default true)" },
                { name: "include_schema", type: "boolean", required: false, description: "Include structured data recommendations (default true)" },
              ],
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
              queryParameters: [
                { name: "company_name", type: "string", required: false, description: "Company name to enrich" },
                { name: "website", type: "string", required: false, description: "Company website URL" },
              ],
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
              queryParameters: [
                { name: "company_name", type: "string", required: false, description: "Company name to check" },
                { name: "profile_url", type: "string", required: false, description: "URL of the company's profile or website" },
              ],
            },
            {
              slug: "proposal-generator",
              name: "Proposal Generator",
              description: "Generate a structured business proposal: executive summary, scope of work, deliverables, timeline, pricing framework, terms suggestions, and next steps. $5.00-$25.00.",
              category: "business",
              tags: ["proposal", "business", "sales", "b2b", "document", "generation", "professional-services"],
              upstreamUrl: "/api/workflows/proposal-generator",
              method: "POST",
              priceAtomic: 10000000,
              queryParameters: [
                { name: "service", type: "string", required: false, description: "Service being proposed" },
                { name: "company", type: "string", required: false, description: "Your company name" },
                { name: "client_requirements", type: "string", required: false, description: "Client's requirements or problem statement" },
                { name: "tone", type: "string", required: false, description: "Proposal tone: professional, friendly, formal" },
                { name: "include_pricing", type: "boolean", required: false, description: "Include pricing framework (default true)" },
                { name: "proposal_length", type: "string", required: false, description: "Length: short, standard, comprehensive (default standard)" },
              ],
            },
            {
              slug: "business-blueprint",
              name: "Business Blueprint",
              description: "Generate a comprehensive business blueprint: overview, target customers, revenue model, services, competitive landscape, startup requirements, pricing, marketing, sales, operations, and 90-day action plan. $5.00-$20.00.",
              category: "business",
              tags: ["business", "plan", "strategy", "startup", "blueprint", "business-plan", "entrepreneur", "guidance"],
              upstreamUrl: "/api/workflows/business-blueprint",
              method: "POST",
              priceAtomic: 10000000,
              queryParameters: [
                { name: "business_idea", type: "string", required: true, description: "Business idea or concept (e.g. Medical courier service)" },
                { name: "location", type: "string", required: false, description: "Location for the business (e.g. Miami, Florida)" },
                { name: "include_market_research", type: "boolean", required: false, description: "Include web research for market context (default true)" },
              ],
            },
            {
              slug: "document-analysis",
              name: "Document Intelligence",
              description: "Extract text from uploaded documents (PDF, text, invoices, business docs), summarize, identify key entities, important dates, and action items. Supports PDF, text, invoice, contract, meeting notes, resumes, and reports. $3.00 per document.",
              category: "document-processing",
              tags: ["document", "pdf", "text", "analysis", "extraction", "summarization", "entities", "dates", "action-items"],
              upstreamUrl: "/api/workflows/document-analysis",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "file", type: "string", required: true, description: "Uploaded document as Buffer, Uint8Array, or data URI string (max 10MB)" },
                { name: "filename", type: "string", required: false, description: "Original filename for context" },
                { name: "document_type", type: "string", required: false, description: "Document type hint: auto, invoice, contract, meeting_notes, resume, report, email, or document" },
              ],
            },
            {
              slug: "invoice-extract",
              name: "Invoice Extraction",
              description: "Extract structured invoice data: vendor, invoice number, dates, currency, subtotal, tax, total, and line items. Supports PDF and image invoices with OCR fallback. $2.00 per invoice.",
              category: "document-processing",
              tags: ["invoice", "extraction", "ocr", "document", "finance", "accounting", "data-extraction", "receipt"],
              upstreamUrl: "/api/workflows/invoice-extract",
              method: "POST",
              priceAtomic: 2000000,
              queryParameters: [
                { name: "file", type: "string", required: true, description: "Invoice document as Buffer, Uint8Array, or data URI string (max 10MB)" },
                { name: "filename", type: "string", required: false, description: "Original invoice filename" },
              ],
            },
            {
              slug: "contract-review",
              name: "Contract Analysis",
              description: "Analyze contracts: summarize, identify parties, obligations, dates, payment terms, termination terms, and important clauses (confidentiality, IP, indemnification, liability, governing law, etc.). INFORMATIONAL ONLY — NOT legal advice. $5.00 per document.",
              category: "document-processing",
              tags: ["contract", "legal", "analysis", "review", "documents", "compliance", "risk", "obligations"],
              upstreamUrl: "/api/workflows/contract-review",
              method: "POST",
              priceAtomic: 5000000,
              queryParameters: [
                { name: "file", type: "string", required: true, description: "Contract document as Buffer, Uint8Array, or data URI string (max 10MB)" },
                { name: "filename", type: "string", required: false, description: "Original contract filename" },
              ],
            },
            {
              slug: "deep-research",
              name: "Deep Research",
              description: "Multi-step research workflow: creates a research plan, searches multiple sources, gathers evidence, cross-checks information, identifies uncertainty, and generates findings with sources. Supports basic/standard/deep/enterprise depth. $5.00-$50.00.",
              category: "research",
              tags: ["research", "deep-research", "analysis", "synthesis", "evidence", "sources", "multi-step", "intelligence"],
              upstreamUrl: "/api/workflows/deep-research",
              method: "POST",
              priceAtomic: 10000000,
              queryParameters: [
                { name: "question", type: "string", required: true, description: "Research question to investigate" },
                { name: "depth", type: "string", required: false, description: "Research depth: basic, standard, deep, enterprise (default standard)" },
              ],
            },
            {
              slug: "due-diligence",
              name: "Business Due Diligence",
              description: "Research a company + website, analyze public reputation, news, competitors, identify risks and positive indicators, and generate a due diligence summary. Clearly labels verified facts, public information, AI analysis, and unknowns. $5.00-$25.00.",
              category: "business-intelligence",
              tags: ["due-diligence", "research", "risk", "reputation", "analysis", "business", "verification", "assessment"],
              upstreamUrl: "/api/workflows/due-diligence",
              method: "POST",
              priceAtomic: 10000000,
              queryParameters: [
                { name: "company", type: "string", required: false, description: "Company name to research" },
                { name: "website", type: "string", required: false, description: "Company website URL" },
                { name: "include_competitor_analysis", type: "boolean", required: false, description: "Include competitor research (default true)" },
              ],
            },
            {
              slug: "social-analysis",
              name: "Social Media Analysis",
              description: "Analyze publicly accessible social media profile data: profile overview, content patterns, topic analysis, engagement indicators where available, competitor opportunities, and content recommendations. Only public data. $3.00 per profile.",
              category: "social-media",
              tags: ["social-media", "analysis", "profile", "content", "engagement", "research", "public-data", "instagram", "twitter", "linkedin", "tiktok"],
              upstreamUrl: "/api/workflows/social-analysis",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "profile_url", type: "string", required: true, description: "URL of the social media profile to analyze" },
                { name: "platform", type: "string", required: false, description: "Platform: instagram, twitter, facebook, linkedin, tiktok, youtube, generic" },
              ],
            },
            {
              slug: "candidate-analysis",
              name: "Candidate Analysis",
              description: "Analyze a resume (file upload or text) against a job description. Returns skills match, experience assessment, strengths, missing qualifications, and suggested interview questions. Assistive tool only — NOT for making employment decisions. $3.00 per analysis.",
              category: "hr",
              tags: ["hr", "candidate", "resume", "job-description", "hiring", "skills-match", "interview", "analysis"],
              upstreamUrl: "/api/workflows/candidate-analysis",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "resume", type: "string", required: false, description: "Resume file as Buffer, Uint8Array, or data URI string (max 10MB)" },
                { name: "resume_text", type: "string", required: false, description: "Resume text content (if not uploading file)" },
                { name: "job_description", type: "string", required: true, description: "Job description text (at least 10 characters)" },
              ],
            },
            {
              slug: "business-email",
              name: "Business Email Sequence",
              description: "Generate business email content: cold outreach, follow-ups, sales sequences, partnership outreach, customer responses, networking, thank you, and breakup emails. Supports small/medium/large packages. $1.00-$10.00.",
              category: "communication",
              tags: ["email", "business", "outreach", "communication", "sales", "follow-up", "sequence", "copywriting"],
              upstreamUrl: "/api/workflows/business-email",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "purpose", type: "string", required: true, description: "Email purpose: cold_outreach, follow_up, sales_sequence, partnership, customer_response, networking, thank_you, breakup_email" },
                { name: "recipient_name", type: "string", required: false, description: "Recipient's name" },
                { name: "recipient_company", type: "string", required: false, description: "Recipient's company" },
                { name: "sender_name", type: "string", required: false, description: "Sender's name" },
                { name: "sender_company", type: "string", required: false, description: "Sender's company" },
                { name: "package", type: "string", required: false, description: "Package: small (1 email), medium (3 emails), large (7 emails)" },
                { name: "context", type: "object", required: false, description: "Context object with specific details to personalize the email" },
              ],
            },
            {
              slug: "ai-agent-execute",
              name: "AI Agent Task Executor",
              description: "Takes a natural-language task, classifies it, estimates complexity, plans and executes subtasks using a controlled tool registry, and returns a structured result. Tool execution is controlled and permissioned — no arbitrary command execution. $1.00-$25.00+ based on complexity.",
              category: "ai-agent",
              tags: ["ai-agent", "task-execution", "automation", "agent", "orchestration", "tool-use", "complex-tasks", "intelligence"],
              upstreamUrl: "/api/agent/execute",
              method: "POST",
              priceAtomic: 3000000,
              queryParameters: [
                { name: "task", type: "string", required: true, description: "Natural-language task description (at least 5 characters)" },
                { name: "allowed_tools", type: "array", required: false, description: "Optional list of allowed tool names — if empty, all registered tools are available" },
                { name: "max_steps", type: "integer", required: false, description: "Maximum execution steps (default 15)" },
              ],
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