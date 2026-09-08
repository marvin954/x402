
/**
 * Sales Prospecting Workflow — POST /api/workflows/sales-prospect
 *
 * Finds businesses in an industry + location, researches each company,
 * identifies pain points, scores the prospect, and generates personalized
 * outreach messages.
 */
import { webSearch, scrape, chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function salesProspect(input, req) {
  const { industry, location, count = 25, enrich = true } = input;
  if (!industry || typeof industry !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"industry" is required' } };
  }
  const safeCount = Math.min(Math.max(1, count), 100);
  const query = [industry, location].filter(Boolean).join(", ");

  // 1. Web search for businesses
  const searchResults = await webSearch(query, { maxResults: Math.min(safeCount * 4, 100) });

  // 2. Extract candidates
  const candidates = searchResults
    .filter(r => r.url)
    .map((r, i) => ({
      id: `cand-${i + 1}`,
      company: extractCompanyName(r.title, industry),
      website: r.url,
      snippet: r.snippet,
      sourceRank: i + 1,
    }))
    .slice(0, safeCount);

  if (candidates.length === 0) {
    return {
      success: true,
      data: { prospects: [], summary: { totalProspects: 0, industry, location, searchQuery: query } },
      metadata: { completedAt: new Date().toISOString() },
    };
  }

  // 3. Scrape each website for enrichment (concurrent, limited)
  const enriched = await Promise.allSettled(
    candidates.map(async (c) => {
      try {
        const info = await scrape(c.website);
        return { ...c, ...info, scraped: true };
      } catch {
        return { ...c, scraped: false };
      }
    })
  );

  const prospected = enriched.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return candidates[i];
  });

  // 4. AI analysis for each prospect: pain points + outreach
  const prospects = [];
  for (let i = 0; i < prospected.length; i += 3) {
    const batch = prospected.slice(i, i + 3);
    const batchText = batch.map((p, idx) => `
Company ${idx + 1}:
  Name: ${p.company || "(unknown)"}
  Website: ${p.website || "none"}
  Description: ${p.description || p.content_summary || p.snippet || "none"}
  Services/Products: ${p.technologies?.join(", ") || "unknown"}
  Location: ${location || "unknown"}
  Industry: ${industry}
`).join("\n");

    try {
      const analysis = await chatJson([
        { role: "system", content: `You are a B2B sales prospecting expert. For each company below, return a JSON array of objects with: company (name), services (array of likely services based on context), lead_score (0-100 based on how good a prospect they are for a ${industry} business in ${location}), pain_points (array of 2-4 likely pain points), outreach (one personalized cold outreach message under 150 words that references their business and a specific pain point). Only return valid JSON array, no other text.` },
        { role: "user", content: batchText },
      ], { temperature: 0.4 });

      if (Array.isArray(analysis)) {
        for (const a of analysis) {
          const p = batch.find(b => b.company === a.company || b.id === a.company);
          if (p) {
            p.services = a.services ?? [];
            p.lead_score = a.lead_score ?? 50;
            p.pain_points = a.pain_points ?? [];
            p.outreach = a.outreach ?? "";
          }
        }
      }
    } catch (err) {
      console.error("[sales-prospect] AI analysis batch error:", err.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Build final prospects
  const finalProspects = prospected.map((p, i) => ({
    id: `prospect-${i + 1}`,
    company: p.company || "(business)",
    website: p.website || "",
    services: p.services || [],
    description: p.description || p.content_summary || p.snippet || "",
    lead_score: p.lead_score || 50,
    pain_points: p.pain_points || [],
    outreach: p.outreach || "",
    scraped: !!p.scraped,
  }));

  finalProspects.sort((a, b) => b.lead_score - a.lead_score);
  const avgScore = finalProspects.reduce((s, p) => s + p.lead_score, 0) / finalProspects.length || 0;
  const topScore = finalProspects[0]?.lead_score || 0;

  return {
    success: true,
    data: {
      prospects: finalProspects,
      summary: {
        totalProspects: finalProspects.length,
        industry,
        location,
        averageLeadScore: Math.round(avgScore * 10) / 10,
        topProspectScore: topScore,
        searchQuery: query,
      },
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractCompanyName(title, industry) {
  if (!title) return "(unknown company)";
  let name = title
    .replace(/[-–—|]/g, " ")
    .replace(/\b(?:best|top|rated|near me|find|search|results|list|guide|review|reviews|compare|vs|versus|hire|price|cost|how to|what is|about|the|official|service|services|solutions|inc|llc|co|company|business|provider|contractor|experts|pros|specialists|professionals|agency|plumbing|roofing|hvac|moving|cleanup)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2) name = title.slice(0, 60);
  return name || "(company)";
}
