
/**
 * Lead Research Workflow — POST /api/workflows/lead-research
 *
 * Searches for businesses matching industry + location, scores them, and
 * generates personalized outreach angles. Real work: web search + website
 * scraping + AI lead scoring + outreach generation.
 */
import { webSearch, scrape, chatJson, withConcurrency } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function leadResearch(input, req) {
  const { industry, location, count = 20, enrich = true } = input;
  if (!industry || typeof industry !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"industry" is required' } };
  }

  const safeCount = Math.min(Math.max(1, count), 100);
  const query = [industry, location].filter(Boolean).join(", ");

  // 1. Web search for businesses
  const searchResults = await webSearch(query, { maxResults: Math.min(safeCount * 3, 100) });

  // 2. Extract candidate businesses from search results
  const candidates = searchResults
    .filter(r => r.title && r.url)
    .map((r, i) => ({
      id: `candidate-${i + 1}`,
      name: extractBusinessName(r.title, industry),
      website: r.url,
      snippet: r.snippet,
      sourceRank: i + 1,
    }))
    .slice(0, safeCount);

  if (candidates.length === 0) {
    return {
      success: true,
      data: { leads: [], summary: { totalLeads: 0, industry, location, searchQuery: query, note: "No leads found — try broader criteria" } },
      metadata: { completedAt: new Date().toISOString() },
    };
  }

  // 3. Scrape websites for contact info + description (concurrent, limited)
  const scraped = await Promise.allSettled(
    candidates.map(c => withConcurrency(async () => {
      try {
        const info = await scrape(c.website);
        return { ...c, scraped: true, ...info };
      } catch {
        return { ...c, scraped: false };
      }
    }))
  );

  const leads = scraped.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { ...candidates[i], scraped: false };
  });

  // 4. AI enrichment: score + outreach (batched in groups to avoid token overload)
  const enriched = [];
  for (let i = 0; i < leads.length; i += 5) {
    const batch = leads.slice(i, i + 5);
    const batchText = batch.map((l, idx) => `
Lead ${idx + 1}:
  Name: ${l.name || "(unknown)"}
  Website: ${l.website || "none"}
  Description: ${l.description || l.content_summary || l.snippet || "none"}
  Social: ${JSON.stringify(l.social_links || [])}.
`).join("\n");

    try {
      const scores = await chatJson([
        { role: "system", content: `You are a lead scoring assistant. For each lead below, return a JSON array of objects with: id (lead-N), name, lead_score (0-100), pain_points (array of 2-4 strings), outreach_email_subject (string), outreach_email_body (string under 150 words). Only return the JSON array, no other text. Industry context: ${industry}. Location: ${location}.` },
        { role: "user", content: batchText },
      ], { model: "gpt-4o-mini", temperature: 0.3 });

      if (Array.isArray(scores)) {
        for (const s of scores) {
          const lead = batch.find(b => `lead-${leads.indexOf(b) + 1}` === s.id || b.name === s.name);
          if (lead) {
            lead.lead_score = s.lead_score ?? 50;
            lead.pain_points = s.pain_points ?? [];
            lead.outreach_email_subject = s.outreach_email_subject ?? "";
            lead.outreach_email_body = s.outreach_email_body ?? "";
          }
        }
      }
    } catch (err) {
      console.error("[lead-research] AI enrichment batch error:", err.message);
      // continue without AI scores
    }
    await new Promise(r => setTimeout(r, 200)); // rate limit
  }

  // Build final leads
  const finalLeads = leads.map((l, i) => ({
    id: `lead-${i + 1}`,
    name: l.name || "(business)",
    website: l.website || "",
    email: l.contacts?.find(c => c.type === "email")?.value || "",
    phone: l.contacts?.find(c => c.type === "phone")?.value || "",
    address: l.contacts?.find(c => c.type === "address")?.value || "",
    description: l.description || l.content_summary || l.snippet || "",
    technologies: l.technologies || [],
    social_links: l.social_links || [],
    lead_score: l.lead_score || 50,
    pain_points: l.pain_points || [],
    outreach_email_subject: l.outreach_email_subject || "",
    outreach_email_body: l.outreach_email_body || "",
    scraped: !!l.scraped,
  }));

  // Sort by score descending
  finalLeads.sort((a, b) => b.lead_score - a.lead_score);

  const avgScore = finalLeads.reduce((s, l) => s + l.lead_score, 0) / finalLeads.length || 0;
  const withContact = finalLeads.filter(l => l.email || l.phone).length;

  return {
    success: true,
    data: {
      leads: finalLeads,
      summary: {
        totalLeads: finalLeads.length,
        industry,
        location,
        averageLeadScore: Math.round(avgScore * 10) / 10,
        leadsWithContact: withContact,
        searchQuery: query,
        aiEnriched: enrich,
      },
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractBusinessName(title, industry) {
  if (!title) return "(unknown business)";
  // Try to strip search noise
  let name = title
    .replace(/[-–—|]/g, " ")
    .replace(/\b(?:best|top|rated|near me|find|search|results|list|guide|review|reviews|compare|vs|versus|vs\.|hire|price|cost|how to|what is|about|the|official)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 3) name = title.slice(0, 60);
  return name || "(business)";
}
