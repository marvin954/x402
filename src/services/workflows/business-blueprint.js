/**
 * Business Blueprint Workflow — POST /api/workflows/business-blueprint
 *
 * Generates a comprehensive business blueprint: overview, target customers,
 * revenue model, services, competitive landscape, startup requirements,
 * pricing strategy, marketing strategy, sales strategy, operational plan,
 * and 90-day action plan.
 *
 * AI-generated strategic guidance — not professional advice.
 */
import { chatJson, webSearch } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function businessBlueprint(input, req) {
  // Accept both spec and legacy field names
  const business_idea = input.business_idea || input.businessType;
  const location = input.location;
  const industry = input.industry;
  const target_market = input.target_market;
  const complexity = input.complexity || "medium";
  const include_market_research = input.include_market_research ?? true;

  if (!business_idea && !target_market) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"business_idea" or "target_market" is required' } };
  }
  if (typeof business_idea !== "string" || business_idea.trim().length < 5) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"business_idea" must be a string with at least 5 characters' } };
  }

  const complexity_map = { basic: "basic", beginner: "basic", easy: "basic", low: "basic", starter: "basic", intermediate: "intermediate", medium: "intermediate", moderate: "intermediate", advanced: "advanced", hard: "advanced", complex: "advanced", expert: "advanced", enterprise: "advanced" };
  const effectiveComplexity = complexity_map[complexity] || "intermediate";

  // Gather market context if requested
  let market_context = "";
  if (include_market_research) {
    const queries = [
      business_idea + " market " + (location || ""),
      business_idea + " startup costs " + (location || ""),
      business_idea + " trends 2025 2026",
      business_idea + " competitors " + (location || ""),
    ];
    const results = [];
    for (const q of queries) {
      try {
        const r = await webSearch(q, { maxResults: 6 });
        results.push({ query: q, results: r });
      } catch { results.push({ query: q, results: [] }); }
    }
    market_context = results.map((m) => "QUERY: " + m.query + "\nRESULTS:\n" + m.results.map((r) => "  - " + r.title + ": " + (r.snippet || "")).join("\n")).join("\n\n");
  }

  const prompt = `Generate a comprehensive business blueprint for: ${business_idea} in ${location || "the target market"}.

${market_context ? "MARKET CONTEXT (from research):\n\n" + market_context + "\n\n" : ""}
Return a JSON object with:

- executive_summary (2-3 paragraphs overview of the business opportunity)
- business_overview (what the business does, value proposition)
- target_customers (array of {segment, description, estimated_size, needs})
- revenue_model (object: {model_type, revenue_streams (array), pricing_strategy_summary})
- competitive_landscape (object: {summary, key_competitor_types (array), competitive_advantages (array), challenges (array)})
- startup_requirements (object: {estimated_investment_range, key_resources (array), legal_and_compliance (array), equipment_or_technology (array), staffing (array)})
- pricing_strategy (object: {approach, recommended_range, competitive_positioning, justification})
- marketing_strategy (object: {target_channels (array), messaging_themes (array), customer_acquisition_approach, estimated_budget_range})
- sales_strategy (object: {sales_approach, sales_channels (array), conversion_strategy, retention_strategy})
- operational_plan (object: {daily_operations_summary, key_processes (array), technology_and_tools (array), quality_assurance, scalability_considerations})
- ninety_day_action_plan (object: {days_1_to_30 (array of {action, priority, owner}), days_31_to_60 (array), days_61_to_90 (array)})
- financial_projections_overview (object: {startup_cost_estimate_range, monthly_overhead_estimate_range, revenue_projection_note (clearly labeled as hypothetical estimate), break_even_note (labeled as estimate only)})
- disclaimer (note: financial figures are hypothetical estimates only; market data is from public sources; this is AI-generated strategic guidance, not professional advice; consult qualified professionals)

Only return valid JSON. No markdown, no other text. Clearly label financial figures as estimates only.`;

  try {
    const result = await chatJson([
      { role: "system", content: "You are a business strategy consultant. Return ONLY valid JSON, no markdown, no other text. Clearly label all financial figures as hypothetical estimates. Market data is from public sources. This is strategic guidance only, not professional business, legal, or financial advice." },
      { role: "user", content: prompt },
    ], { temperature: 0.3, max_tokens: 4096 });

    if (result) {
      result.generated_from = { business_idea, location, industry, market_research_included: include_market_research };
      result.strategy_type = "AI-generated strategic guidance based on public market research. All financial figures are hypothetical estimates.";
    }
    return { success: true, data: result || { exec_summary: "Business blueprint for " + business_idea }, metadata: { completedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("[business-blueprint] AI error:", err.message);
    return { success: true, data: fallbackBlueprint(business_idea, location, industry), metadata: { completedAt: new Date().toISOString() } };
  }
}

function fallbackBlueprint(idea, location, industry) {
  return {
    executive_summary: "This blueprint provides a strategic framework for starting a " + idea + " business in " + (location || "the target market") + ". The business concept addresses market demand for " + (industry || "the relevant industry") + " services/products. This is AI-generated strategic guidance — all financial figures are hypothetical estimates only.",
    business_overview: "A " + idea + " business providing services/products to customers seeking " + (industry || "the relevant industry") + " solutions. The business would focus on quality, competitive pricing, and customer satisfaction.",
    target_customers: [
      { segment: "Primary customers", description: "Individuals and businesses seeking " + idea + " services/products", estimated_size: "Variable — requires local market research", needs: ["Quality service/product", "Competitive pricing", "Reliability", "Good customer service"] },
      { segment: "Secondary customers", description: "Related market segments that may also benefit", estimated_size: "Variable — requires local market research", needs: ["Specific solutions", "Convenience", "Value"] },
    ],
    revenue_model: {
      model_type: "Service-based (or product-based depending on specifics)",
      revenue_streams: ["Direct service/product sales", "Package deals or bundles where applicable", "Recurring revenue from repeat customers"],
      pricing_strategy_summary: "Competitive pricing with premium options for enhanced service levels",
    },
    competitive_landscape: {
      summary: "The " + idea + " market in " + (location || "the target market") + " has multiple providers. Success depends on differentiation through quality, service, pricing, or specialization.",
      key_competitor_types: ["Established local businesses", "Online/digital competitors", "National chains with local presence"],
      competitive_advantages: ["Local market knowledge", "Personalized service", "Flexibility", "Community relationships"],
      challenges: ["Price competition", "Customer acquisition costs", "Building reputation and trust"],
    },
    startup_requirements: {
      estimated_investment_range: "$1,000 - $50,000+ depending on scale and business type — estimate only, validate with actual quotes",
      key_resources: ["Business registration and licenses", "Equipment/tools specific to the business type", "Initial marketing and web presence", "Working capital for first months of operation"],
      legal_and_compliance: ["Business registration (LLC/corporation/etc.)", "Local business licenses and permits", "Insurance as required for the industry", "Tax registration and compliance"],
      equipment_or_technology: ["Industry-specific equipment", "Website and online presence", "Business management software", "Communication tools"],
      staffing: ["Founder/owner initially", "Additional staff as business grows", "Possible subcontractors for specialized work"],
    },
    pricing_strategy: {
      approach: "Market-competitive pricing with potential for premium tiers",
      recommended_range: "Research local competitors to determine appropriate pricing",
      competitive_positioning: "Position based on quality, service, convenience, or specialization relative to competitors",
      justification: "Pricing should cover costs + margin while remaining competitive. Premium pricing possible if differentiation supports it.",
    },
    marketing_strategy: {
      target_channels: ["Google Business Profile / local SEO", "Social media (platforms relevant to target audience)", "Local networking and referrals", "Website with clear value proposition", "Paid advertising where ROI justifies it"],
      messaging_themes: ["Quality and reliability", "Local expertise", "Customer focus", "Value for money"],
      customer_acquisition_approach: "Build organic presence first (website, reviews, referrals), then add paid channels where ROI supports it",
      estimated_budget_range: "$500-$5,000/month depending on scale — estimate only",
    },
    sales_strategy: {
      sales_approach: "Consultative sales focusing on understanding customer needs and presenting solutions",
      sales_channels: ["Direct outreach and networking", "Website inquiries and conversions", "Referrals from satisfied customers", "In-person consultations where applicable"],
      conversion_strategy: "Build trust through expertise, testimonials, and clear communication of value",
      retention_strategy: "Excellent service, follow-up, and relationship building to generate repeat business and referrals",
    },
    operational_plan: {
      daily_operations_summary: "Day-to-day operations include serving customers, managing quality, handling administration, and executing marketing activities",
      key_processes: ["Customer inquiry and qualification", "Service/product delivery", "Quality control and review", "Invoicing and payment collection", "Marketing and outreach", "Review and improvement"],
      technology_and_tools: ["Website and booking/contact system", "Business management tools", "Communication platforms", "Industry-specific software as needed"],
      quality_assurance: "Standard operating procedures, customer feedback, and regular quality reviews",
      scalability_considerations: "Plan for growth in staffing, systems, and capacity as the business expands",
    },
    ninety_day_action_plan: {
      days_1_to_30: [
        { action: "Finalize business plan and validate assumptions", priority: "high", owner: "Founder" },
        { action: "Register business and obtain licenses/permits", priority: "high", owner: "Founder + professional" },
        { action: "Set up business banking, insurance, and accounting", priority: "high", owner: "Founder" },
        { action: "Build basic web presence (website, Google Business Profile)", priority: "high", owner: "Founder or contractor" },
        { action: "Acquire initial equipment and supplies", priority: "medium", owner: "Founder" },
        { action: "Develop initial service offerings and pricing", priority: "high", owner: "Founder" },
        { action: "Create marketing materials and messaging", priority: "medium", owner: "Founder" },
      ],
      days_31_to_60: [
        { action: "Launch marketing and begin outreach", priority: "high", owner: "Founder + marketing" },
        { action: "Begin accepting customers", priority: "high", owner: "Founder" },
        { action: "Collect testimonials and build reputation", priority: "medium", owner: "Founder" },
        { action: "Refine operations based on initial feedback", priority: "medium", owner: "Founder" },
        { action: "Network locally to build relationships", priority: "medium", owner: "Founder" },
      ],
      days_61_to_90: [
        { action: "Review first months' results and adjust strategy", priority: "high", owner: "Founder" },
        { action: "Scale marketing efforts based on what works", priority: "high", owner: "Founder" },
        { action: "Consider staffing needs for growth", priority: "medium", owner: "Founder" },
        { action: "Build recurring revenue where applicable", priority: "medium", owner: "Founder" },
        { action: "Plan next quarter priorities", priority: "medium", owner: "Founder" },
      ],
    },
    financial_projections_overview: {
      startup_cost_estimate_range: "$1,000 - $50,000+ depending on business type and scale — HYPOTHETICAL ESTIMATE ONLY",
      monthly_overhead_estimate_range: "$500 - $10,000+/month depending on business type — HYPOTHETICAL ESTIMATE ONLY",
      revenue_projection_note: "Revenue depends on market demand, pricing, and execution quality — this is a hypothetical estimate, not a projection",
      break_even_note: "Break-even timeline varies widely by business type — research specific to your industry and location",
      disclaimer: "ALL financial figures are HYPOTHETICAL ESTIMATES ONLY. Actual costs, revenue, and timelines must be validated with real market research, quotes, and financial planning. This is NOT financial advice.",
    },
    disclaimer: "This business blueprint is AI-generated strategic guidance based on public market research. All financial figures are hypothetical estimates only, not projections. Market data comes from public web search results and may not reflect current local conditions. This is NOT professional business, legal, or financial advice. Consult qualified professionals (business advisors, accountants, lawyers) before making business decisions. Market conditions change — validate all assumptions with current local research.",
    generated_from: { business_idea: idea, location: location || "not specified", industry: industry || "not specified", market_research_included: true },
    strategy_type: "AI-generated strategic guidance based on public market research. All financial figures are hypothetical estimates.",
  };
}
