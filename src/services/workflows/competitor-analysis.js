/**
 * Competitor Analysis Workflow — POST /api/workflows/competitor-analysis
 *
 * Analyzes a target business, identifies competitors, researches their
 * websites, compares services/positioning/SEO, and identifies market
 * opportunities and threats.
 */
import { webSearch, scrape, chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function competitorAnalysis(input, req) {
  // Accept both spec and legacy field names
  const competitors = input.competitors || input.competitorNames || input.competitor_list || [];
  const business_name = input.business_name || input.target_business || input.business;
  const industry = input.industry;
  const location = input.location;
  const competitor_count = input.competitor_count || input.count || 5;
  const business_url = input.business_url || input.url || input.website;
  if (!business_name && !competitors.length) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: 'Either "business_name" or "competitors" is required' } };
  }
  const safeCount = Math.min(Math.max(1, competitor_count), 20);

  // 1. Analyze the target business
  let target = {};
  if (business_url) {
    try { target.scraped = await scrape(business_url); } catch {}
    target.url = business_url;
  }
  if (business_name) target.name = business_name;
  if (!target.name && target.scraped?.title) target.name = target.scraped.title;
  if (!target.name) target.name = "(business)";
  if (!target.scraped?.description) target.description = target.scraped?.description || "";

  // 2. Identify competitors via web search
  const compQuery = `${target.name} competitor ${business_url || ""}`.trim();
  let searchResults = [];
  try { searchResults = await webSearch(compQuery, { maxResults: safeCount * 3 }); } catch {}

  // 3. Extract competitor URLs and names
  const foundCompetitors = [];
  const seen = new Set();
  for (const r of searchResults) {
    if (foundCompetitors.length >= safeCount) break;
    const url = r.url;
    if (!url || seen.has(url) || url === business_url) continue;
    const name = extractName(r.title, target.name);
    if (name) {
      seen.add(url);
      foundCompetitors.push({ name, url, snippet: r.snippet });
    }
  }

  // If we don't have enough competitors, search for "{industry} alternatives"
  if (foundCompetitors.length < safeCount && target.description) {
    const altQuery = `alternatives to ${target.name}`;
    let altResults = [];
    try { altResults = await webSearch(altQuery, { maxResults: safeCount * 2 }); } catch {}
    for (const r of altResults) {
      if (foundCompetitors.length >= safeCount) break;
      const url = r.url;
      if (!url || seen.has(url) || url === business_url) continue;
      const name = extractName(r.title, target.name);
      if (name && name !== target.name) {
        seen.add(url);
        foundCompetitors.push({ name, url, snippet: r.snippet });
      }
    }
  }

  // 4. Scrape competitor websites
  const scrapedCompetitors = await Promise.allSettled(
    foundCompetitors.map(async (c) => {
      try {
        const info = await scrape(c.url);
        return { ...c, ...info, scraped: true };
      } catch {
        return { ...c, scraped: false };
      }
    })
  );

  // 5. AI comparison analysis
  const targetSummary = `
Target: ${target.name}
URL: ${business_url || "none"}
Description: ${target.description || "none"}
Technologies: ${target.scraped?.technologies ? target.scraped.technologies.join(", ") : "unknown"}
Services/Content: ${extractServices(target.scraped || {})}
`;

  const compSummaries = scrapedCompetitors
    .filter(r => r.status === "fulfilled")
    .map((r, i) => {
      const c = r.value;
      return `
Competitor ${i + 1}: ${c.name}
URL: ${c.url}
Description: ${c.description || c.content_summary || c.snippet || "none"}
Technologies: ${c.technologies?.join(", ") || "unknown"}
`;
    })
    .join("\n");

  let comparison = null;
  if (scrapedCompetitors.filter(r => r.status === "fulfilled").length > 0) {
    try {
      comparison = await chatJson([
        { role: "system", content: "You are a competitive intelligence analyst. Return a JSON object with: competitor_profiles (array of {name, strengths, weaknesses, estimatedPositioning, estimatedPriceTier, estimatedTargetAudience}), comparison_matrix (object keyed by dimension with target vs competitors), opportunities (array of market opportunities), threats (array of threats), recommendations (array of strategic recommendations). Dimensions to compare: services, pricing (estimate), positioning, SEO visibility (estimate from content quality), target audience, technology stack." },
        { role: "user", content: "Target Business:\n" + targetSummary + "\n\nCompetitors:\n" + compSummaries + "\n\nGenerate a comprehensive competitive analysis report." },
      ], { temperature: 0.3 });
    } catch (err) {
      console.error("[competitor-analysis] AI comparison error:", err.message);
    }
  }

  // Build response
  const profiles = scrapedCompetitors
    .filter(r => r.status === "fulfilled")
    .map(r => r.value);

  const recommendations = [
    "Consider differentiating on " + (comparison?.opportunities?.[0]?.toLowerCase() || "unique value proposition"),
    "Review competitor pricing and positioning gaps",
    "Identify underserved customer segments",
    "Monitor competitor content strategy and SEO performance",
    "Leverage observed competitor weaknesses in your messaging",
  ].filter(Boolean);

  return {
    success: true,
    data: {
      target: {
        name: target.name,
        url: business_url || null,
        description: target.description || null,
        scraped: !!target.scraped,
      },
      competitors: profiles.map(c => ({
        name: c.name,
        url: c.url,
        description: c.description || c.content_summary || c.snippet || null,
        technologies: c.technologies || null,
        scraped: c.scraped,
      })),
      comparison: comparison || {
        competitor_profiles: profiles.slice(0, 5).map(c => ({ name: c.name, strengths: [], weaknesses: [], estimatedPositioning: "unknown", estimatedPriceTier: "unknown", estimatedTargetAudience: "unknown" })),
        comparison_matrix: {},
        opportunities: [],
        threats: [],
        recommendations: [],
      },
      market_opportunities: comparison?.opportunities || ["Expand service offerings based on competitor gaps"],
      threats: comparison?.threats || [],
      recommendations: recommendations.slice(0, 10),
      data_quality: {
        competitors_analyzed: profiles.length,
        sources_searched: searchResults.length + (foundCompetitors.length > profiles.length ? 1 : 0),
        verified: false,
        note: "All data from public web search results — not independently verified.",
      },
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractName(title, targetName) {
  if (!title) return null;
  let name = title
    .replace(/\(.*?\) ?/g, "")
    .replace(/[-–—].*$/, "")
    .replace(/\[.*?\] ?/g, "")
    .replace(/\|.*$/, "")
    .replace(/^the /i, "")
    .replace(/\b(company|corp|corporation|inc|llc|lp|pllc|llp|group|holdings|co)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2) name = title.slice(0, 60);
  if (name && name !== targetName && name.length > 2) return name;
  return null;
}

function extractServices(scraped) {
  if (!scraped) return "unknown";
  const keywords = ["services", "solutions", "products", "offerings", "what we do", "about"];
  const content = (scraped.content_summary || scraped.text || "").toLowerCase();
  if (content.includes("service") || content.includes("solution")) return "service-based";
  if (content.includes("product")) return "product-based";
  return "unknown";
}
