/**
 * Business Intelligence Service — POST /v1/business/intelligence
 *
 * Combines website scraping with business enrichment:
 *   Business info · Website analysis · Contact extraction
 *   Technology detection · Social profiles · AI lead score (0-100)
 *
 * Input:  { "businessName"?: string, "url": "https://..." }
 * Output: {
 *   business:        { name, website, industry, estimatedSize, location, description }
 *   website:         { title, description, image, favicon, social_links[], technologies[], content_summary }
 *   contacts:        { emails[], phones[], addresses[], social_profiles[] }
 *   leadScore:       { score: 0-100, grade: "A"|"B"|"C"|"D", breakdown: {...} }
 *   _meta:           { url, businessName, fetchedAt, responseTimeMs }
 * }
 */

import { scrapeWebsite } from "./intelligence.js";

// ─── helpers ────────────────────────────────────────────────────────────────────

const USER_AGENT = "Mozilla/5.0 (compatible; MAMMBA-x402-Business-Intelligence/1.0)";
const TIMEOUT_MS  = parseInt(process.env.BUSINESS_INTELLIGENCE_TIMEOUT_MS || "20000", 10);

// Lazy-import http/https modules at top level so we can use them in async functions
let _httpMod = null;
async function getHttpMod() {
  if (_httpMod) return _httpMod;
  const mod = await import("http");
  const modHttps = await import("https");
  _httpMod = { http: mod.default, https: modHttps.default };
  return _httpMod;
}

async function httpGetJson(url) {
  const target = new URL(url);
  const mods = await getHttpMod();
  const lib = target.protocol === "https:" ? mods.https : mods.http;
  return new Promise((resolve, reject) => {
    const req = lib.get(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      },
      (res) => {
        if (res.statusCode >= 400) return reject(new Error(`Upstream returned ${res.statusCode}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new Error("Bad JSON")); }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ─── industry inference ───────────────────────────────────────────────────────

const INDUSTRY_KEYWORDS = {
  ecommerce:     ["shopify", "stripe", "checkout", "cart", "store", "woocommerce"],
  saas:          ["saas", "dashboard", "api", "next.js", "react", "vue", "angular", "software"],
  agency:        ["agency", "creative", "design", "marketing", "digital", "seo", "branding", "portfolio"],
  consulting:    ["consulting", "advisory", "strategy", "management", "solutions", "services"],
  realestate:    ["real", "estate", "property", "homes", "residential", "commercial", "realtor"],
  healthcare:    ["health", "medical", "clinic", "hospital", "care", "doctor", "pharmacy", "dentist"],
  finance:       ["finance", "financial", "accounting", "tax", "insurance", "investment", "banking", "loan"],
  legal:         ["law", "legal", "attorney", "lawyer", "firm", "justice", "counsel"],
  education:     ["education", "school", "academy", "learning", "course", "training", "university", "college"],
  hospitality:   ["hotel", "restaurant", "cafe", "bar", "brewery", "lodging", "inn", "resort", "food"],
  construction:  ["construction", "contractor", "roofing", "plumbing", "hvac", "electrician", "builder", "remodel"],
  media:         ["media", "publishing", "news", "blog", "journalism", "content", "studio", "production"],
  nonprofit:     ["nonprofit", "ngo", "charity", "foundation", "organization", "cause", "donate", "volunteer"],
  manufacturing: ["manufacturing", "industrial", "factory", "supply", "warehouse", "distribution"],
};

function inferIndustry(website, techs) {
  const signals = [
    website?.title || "",
    website?.description || "",
    website?.content_summary || "",
    (techs || []).join(" "),
  ].join(" ").toLowerCase();

  const scores = {};
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (signals.includes(kw.toLowerCase())) matchCount++;
    }
    if (matchCount > 0) scores[industry] = matchCount;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

// ─── business size estimation ──────────────────────────────────────────────────

function estimateBusinessSize(techs, profiles, emails, hasPhone, hasAddress) {
  let score = 0;
  if (techs.length >= 5) score += 3;
  if (techs.length >= 10) score += 2;
  if (profiles.length >= 3) score += 2;
  if (profiles.length >= 5) score += 1;
  if (emails.length >= 2) score += 1;
  if (hasPhone) score += 1;
  if (hasAddress) score += 1;
  const proTools = ["Stripe", "Google Analytics", "Google Tag Manager", "Mailchimp", "SendGrid", "Segment", "Intercom", "Algolia", "Facebook Pixel"];
  const proCount = (techs || []).filter(t => proTools.includes(t)).length;
  if (proCount >= 2) score += 2;
  if (proCount >= 4) score += 1;

  if (score >= 8) return "enterprise";
  if (score >= 5) return "midmarket";
  if (score >= 3) return "small_business";
  return "solopreneur";
}

// ─── lead scoring engine (0-100) ───────────────────────────────────────────────

function computeLeadScore(data) {
  const breakdown = {};
  let total = 0;

  // Contacts (max 25)
  let c = 0;
  if (data.emails?.length) c += 10;
  if (data.phones?.length) c += 8;
  if (data.addresses?.length) c += 7;
  const methods = [data.emails, data.phones, data.addresses].filter(Boolean).length;
  if (methods >= 2) c += 5;
  if (methods >= 3) c += 3;
  breakdown.contacts = Math.min(c, 25);
  total += breakdown.contacts;

  // Social (max 20)
  let s = 0;
  const profiles = data.social_profiles || [];
  if (profiles.length) s += 8;
  if (profiles.length >= 2) s += 4;
  if (profiles.length >= 3) s += 4;
  if (profiles.length >= 4) s += 4;
  const bizPlatforms = ["linkedin", "facebook", "twitter", "youtube", "instagram"];
  const bizProfiles = profiles.filter(p => bizPlatforms.includes(p.platform));
  if (bizProfiles.length) s += 4;
  breakdown.social_presence = Math.min(s, 20);
  total += breakdown.social_presence;

  // Tech (max 15)
  let t = 0;
  const techs = data.technologies || [];
  if (techs.length) t += 5;
  const modern = ["Next.js", "React", "Vue.js", "Angular", "Svelte", "Gatsby"];
  t += Math.min(techs.filter(x => modern.includes(x)).length * 2, 5);
  const pro = ["Stripe", "Google Analytics", "Google Tag Manager", "Mailchimp", "SendGrid", "Segment", "Intercom", "Algolia"];
  t += Math.min(techs.filter(x => pro.includes(x)).length, 5);
  breakdown.tech_sophistication = Math.min(t, 15);
  total += breakdown.tech_sophistication;

  // Content (max 15)
  let co = 0;
  if (data.website?.description?.length > 20) co += 5;
  if (data.website?.content_summary?.length > 50) co += 5;
  if (data.website?.title?.length > 5) co += 3;
  if (data.website?.image) co += 2;
  breakdown.content_quality = Math.min(co, 15);
  total += breakdown.content_quality;

  // Professional signals (max 15)
  let p = 0;
  if (data.website?.favicon) p += 4;
  if (data.website?.title) p += 3;
  if (data.website?.description) p += 3;
  p = Math.min(p, 15);
  breakdown.professional_signals = p;
  total += breakdown.professional_signals;

  // Business indicators (max 10)
  let b = 0;
  if (data.business?.industry) b += 4;
  if (data.business?.estimatedSize) b += 3;
  if (data.business?.location) b += 3;
  breakdown.business_indicators = Math.min(b, 10);
  total += breakdown.business_indicators;

  const score = Math.max(0, Math.min(100, Math.round(total)));
  let grade = "D";
  if (score >= 80) grade = "A";
  else if (score >= 60) grade = "B";
  else if (score >= 40) grade = "C";

  return { score, grade, breakdown };
}

// ─── main pipeline ─────────────────────────────────────────────────────────────

export async function enrichBusiness({ businessName, url }) {
  const start = Date.now();

  // 1. Website intelligence (reuse existing service)
  let wd = {};
  try { wd = await scrapeWebsite(url); } catch (err) { console.error("[biz] scrape error:", err.message); }

  // 2. Organize contacts
  const contacts = {
    emails:    (wd.contacts || []).filter(c => c.type === "email").map(c => c.value),
    phones:    (wd.contacts || []).filter(c => c.type === "phone").map(c => c.value),
    addresses: (wd.contacts || []).filter(c => c.type === "address").map(c => c.value),
    social_profiles: (wd.social_links || []).map(s => ({ platform: s.platform, url: s.url })),
  };

  // 3. Business profile
  const industry = inferIndustry(
    { title: wd.title, description: wd.description, content_summary: wd.content_summary },
    wd.technologies
  );

  const size = estimateBusinessSize(
    wd.technologies,
    contacts.social_profiles,
    contacts.emails,
    contacts.phones.length > 0,
    contacts.addresses.length > 0
  );

  // 4. Lead score
  const score = computeLeadScore({
    emails:      contacts.emails,
    phones:      contacts.phones,
    addresses:   contacts.addresses,
    social_profiles: contacts.social_profiles,
    technologies: wd.technologies,
    website: {
      title:          wd.title,
      description:    wd.description,
      image:         wd.image,
      favicon:        wd.favicon,
      content_summary: wd.content_summary,
    },
    business: {
      industry,
      estimatedSize: size,
      location: contacts.addresses[0] || "",
    },
  });

  return {
    business: {
      name:         businessName || wd.title || "",
      website:      url,
      industry:     industry || "",
      estimatedSize: size,
      location:     contacts.addresses[0] || "",
      description:  wd.description || "",
    },
    website: {
      title:          wd.title || "",
      description:    wd.description || "",
      image:          wd.image || "",
      favicon:        wd.favicon || "",
      social_links:   wd.social_links || [],
      technologies:   wd.technologies || [],
      content_summary: wd.content_summary || "",
    },
    contacts,
    leadScore: score,
    _meta: {
      url,
      businessName: businessName || null,
      fetchedAt:    new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    },
  };
}
