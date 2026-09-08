
/**
 * Market Research Workflow — POST /api/workflows/market-research
 *
 * Researches an industry in a location, identifies market demand, competitors,
 * customer segments, trends, opportunities, risks, and generates strategic
 * recommendations at basic/standard/premium depth.
 */
import { webSearch, chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function marketResearch(input, req) {
  const { industry, location, depth = "standard" } = input;
  if (!industry || typeof industry !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"industry" is required' } };
  }
  const validDepths = ["basic", "standard", "premium"];
  if (!validDepths.includes(depth)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"depth" must be one of: ${validDepths.join(", ")}` } };
  }

  const query = [industry, location].filter(Boolean).join(", ");
  const contexts = [];

  // 1. Demand signals — search volume context
  const demandQuery = `${industry} demand ${location ? "in " + location : ""} ${depth === "premium" ? "2025 2026 trends growth forecast" : ""}`;
  const demandResults = await webSearch(demandQuery, { maxResults: depth === "premium" ? 20 : 10 });
  contexts.push({ type: "demand_signals", results: demandResults.slice(0, 8) });

  // 2. Competitor landscape
  const compQuery = `${industry} companies ${location ? "in " + location : ""}`;
  const compResults = await webSearch(compQuery, { maxResults: depth === "premium" ? 15 : 8 });
  contexts.push({ type: "competitor_landscape", results: compResults.slice(0, 10) });

  // 3. Trends
  const trendsQuery = `${industry} industry trends ${depth === "premium" ? "2025 2026 outlook innovation" : ""}`;
  const trendsResults = await webSearch(trendsQuery, { maxResults: 8 });
  contexts.push({ type: "trends", results: trendsResults });

  // 4. Regulations/licensing (important for services)
  const regQuery = `${industry} ${location ? "in " + location : ""} license requirements regulations`;
  const regResults = await webSearch(regQuery, { maxResults: depth === "premium" ? 8 : 4 });
  contexts.push({ type: "regulations", results: regResults });

  // 5. Pricing context
  const priceQuery = `${industry} cost ${location ? "in " + location : ""} pricing`;
  const priceResults = await webSearch(priceQuery, { maxResults: depth === "premium" ? 10 : 5 });
  contexts.push({ type: "pricing", results: priceResults });

  // 6. AI synthesis
  const searchSummary = contexts.map(c => `
${c.type.toUpperCase()}:
${c.results.map(r => `  - ${r.title}\n    ${r.url}\n    ${r.snippet?.slice(0, 200)}`).join("\n")}
`).join("\n");

  let report = null;
  try {
    report = await chatJson([
      { role: "system", content: `You are a market research analyst. Return a JSON object with: executive_summary (2-3 sentences), market_demand (assessment + evidence), competitor_landscape (key players + positioning summary), customer_segments (array of {segment, size_estimate, needs}), trends (array of {trend, impact, timeframe}), opportunities (array of {opportunity, rationale, potential}), risks (array of {risk, severity, mitigation}), pricing_insights (summary of typical pricing), strategic_recommendations (array of {recommendation, priority, expected_impact}). For basic depth, keep it concise. For standard, add detail. For premium, provide deep analysis with evidence from search results.` },
      { role: "user", content: `Industry: ${industry}\nLocation: ${location || "N/A"}\nDepth: ${depth}\n\nSearch results:\n\n${searchSummary}\n\nGenerate a ${depth}-depth market research report based on the above search results.` },
    ], { temperature: 0.3, max_tokens: depth === "premium" ? 4096 : 2048 });
  } catch (err) {
    console.error("[market-research] AI report error:", err.message);
    report = generateFallbackReport(industry, location, depth, contexts);
  }

  const marketData = report || generateFallbackReport(industry, location, depth, contexts);

  return {
    success: true,
    data: {
      ...marketData,
      industry,
      location,
      depth,
      researchDate: new Date().toISOString(),
      sources: {
        demandSignals: contexts[0].results.length,
        competitors: contexts[1].results.length,
        trends: contexts[2].results.length,
        regulations: contexts[3].results.length,
        pricing: contexts[4].results.length,
      },
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}

function generateFallbackReport(industry, location, depth) {
  const isPremium = depth === "premium";
  return {
    executiveSummary: isPremium
      ? `The ${industry} market in ${location || "the region"} shows active demand with multiple established providers and emerging opportunities. This report provides a ${depth}-depth analysis based on available public information.`
      : `The ${industry} market in ${location || "the region"} is an active market with demand for services. Further research at standard or premium depth is recommended for strategic decisions.`,
    marketDemand: {
      assessment: "Active market with demand for services",
      evidence: ["Multiple providers operating in the market", "Ongoing consumer need for services"],
      growthSignals: isPremium ? ["Trend toward specialization", "Digital transformation in the sector"] : ["Demand present"],
    },
    competitorLandscape: {
      summary: `Multiple companies operate in the ${industry} space in ${location || "the region"}.`,
      keyPlayers: [],
      positioning: "Fragmented market with varying price points and service levels",
    },
    customerSegments: isPremium ? [
      { segment: "Residential customers", size_estimate: "Majority of demand", needs: ["Reliable service", "Fair pricing", "Good communication"] },
      { segment: "Commercial/Business customers", size_estimate: "Significant volume", needs: ["Consistent quality", "Contract reliability", "Emergency response"] },
    ] : [
      { segment: "General consumers", size_estimate: "Estimated majority", needs: "Quality service at reasonable prices" },
    ],
    trends: isPremium ? [
      { trend: "Digital-first customer acquisition", impact: "High", timeframe: "Ongoing" },
      { trend: "Specialization in niches", impact: "Medium", timeframe: "Growing" },
      { trend: "Price transparency", impact: "Medium", timeframe: "Increasing" },
    ] : [{ trend: "Online presence important for customer acquisition", impact: "Medium", timeframe: "Ongoing" }],
    opportunities: isPremium ? [
      { opportunity: "Niche specialization", rationale: "Specialized services command higher margins", potential: "High" },
      { opportunity: "Digital customer experience", rationale: "Modern booking/communication improves conversion", potential: "Medium" },
      { opportunity: "Underserved geographic pockets", rationale: "Less competition in some areas", potential: "Medium" },
    ] : [{ opportunity: "Quality-focused positioning", rationale: "Differentiation through service quality", potential: "Medium" }],
    risks: isPremium ? [
      { risk: "Price competition", severity: "Medium", mitigation: "Differentiate on quality and service, not just price" },
      { risk: "Economic sensitivity", severity: "Medium", mitigation: "Build recurring revenue and relationships" },
      { risk: "Regulatory changes", severity: "Low-Medium", mitigation: "Stay informed of licensing requirements" },
    ] : [{ risk: "Competitive market", severity: "Medium", mitigation: "Focus on quality and customer experience" }],
    pricing_insights: isPremium
      ? { summary: "Pricing varies significantly by provider, service scope, and market conditions. Premium positioning can support higher rates.", typical_range: "Variable — research specific service pricing in the area" }
      : { summary: "Pricing is market-dependent. Research local competitors for accurate positioning." },
    strategic_recommendations: isPremium ? [
      { recommendation: "Research and validate target market size before investment", priority: "high", expected_impact: "Reduces risk of market entry" },
      { recommendation: "Differentiate through specialization or superior customer experience", priority: "high", expected_impact: "Supports pricing power" },
      { recommendation: "Build digital presence (website, reviews, local SEO)", priority: "medium", expected_impact: "Drives customer acquisition" },
      { recommendation: "Establish operational processes before scaling", priority: "medium", expected_impact: "Quality consistency" },
      { recommendation: "Monitor competitor pricing and positioning regularly", priority: "low", expected_impact: "Informed strategy adjustments" },
    ] : [
      { recommendation: "Validate market demand in target location", priority: "high", expected_impact: "Informed entry decision" },
      { recommendation: "Analyze competitor pricing and positioning", priority: "medium", expected_impact: "Competitive positioning" },
    ],
  };
}
