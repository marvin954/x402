/**
 * Deep Research Workflow — POST /api/workflows/deep-research
 *
 * Multi-step research: creates a research plan, searches multiple sources,
 * gathers evidence, cross-checks information, identifies uncertainty,
 * and generates findings with sources.
 *
 * Depth levels: basic, standard, deep, enterprise.
 */
import { webSearch, chatJson, withConcurrency } from "../../lib/workflow-utils.js";
import { enforceTimeout } from "../../lib/timing.js";
import { success, withMeta } from "../../lib/response.js";

const DEPTH_CONFIG = {
  basic:     { maxSearches: 3,  maxResults: 5,  maxTokens: 1024,  timeout: 30_000 },
  standard:  { maxSearches: 6,  maxResults: 8,  maxTokens: 2048,  timeout: 60_000 },
  deep:      { maxSearches: 12, maxResults: 10, maxTokens: 4096,  timeout: 120_000 },
  enterprise: { maxSearches: 20, maxResults: 12, maxTokens: 4096, timeout: 180_000 },
};

export async function deepResearch(input, req) {
  const { question, focus_areas, max_sources = 10, depth = "standard" } = input;

  if (!question || typeof question !== "string" || question.trim().length < 5) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"question" is required (at least 5 characters)' } };
  }

  if (!DEPTH_CONFIG[depth]) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"depth" must be one of: ${Object.keys(DEPTH_CONFIG).join(", ")}` } };
  }

  const cfg = DEPTH_CONFIG[depth];
  const startTime = Date.now();

  // Step 1: Generate research plan
  let plan;
  try {
    plan = await chatJson([
      { role: "system", content: "You are a research planner. Given a research question, return a JSON array of specific search queries to answer it comprehensively. Return ONLY a JSON array of strings." },
      { role: "user", content: "Research question: " + question + "\nGenerate " + cfg.maxSearches + " targeted search queries as a JSON array of strings." },
    ], { temperature: 0.3, max_tokens: 512 }) || [question];
  } catch (err) {
    console.error("[deep-research] plan error:", err.message);
    plan = [question];
  }
  if (!Array.isArray(plan) || plan.length === 0) plan = [question];

  // Step 2: Execute searches
  const allSources = [];
  const effectivePlan = plan.slice(0, cfg.maxSearches);

  for (const q of effectivePlan) {
    try {
      const results = await withConcurrency(async () =>
        enforceTimeout(cfg.timeout / effectivePlan.length + 5000, async () =>
          webSearch(q, { maxResults: cfg.maxResults })
        )
      );
      if (Array.isArray(results) && results.length > 0) {
        allSources.push({ query: q, results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet?.slice(0, 300) })) });
      }
    } catch (err) {
      console.error("[deep-research] search error for '" + q + "':", err.message);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Step 3: Synthesize findings
  const sourcesText = allSources.map((s) =>
    "QUERY: " + s.query + "\nRESULTS:\n" + s.results.map((r, i) => (i + 1) + ". " + r.title + " (" + r.url + ")\n   " + r.snippet).join("\n")
  ).join("\n\n");

  let synthesis;
  try {
    synthesis = await chatJson([
      { role: "system", content: "You are a research synthesis expert. Based on the search results below, produce a comprehensive research report. Return a JSON object with: executive_summary (2-3 sentences), key_findings (array of {finding, evidence, sources (array of URLs)}), evidence_quality ({strong_evidence (array), weak_evidence (array), gaps (array)}), sources (array of {title, url, relevance, quality_rating}), limitations (array), recommendations (array of {recommendation, rationale}). Distinguish between verified facts, informed analysis, and speculation. Cite sources. Flag uncertainty." },
      { role: "user", content: "Research Question: " + question + "\nDepth: " + depth + "\n\nSearch Results:\n\n" + sourcesText + "\n\nGenerate a comprehensive research report." },
    ], { temperature: 0.25, max_tokens: cfg.maxTokens });
  } catch (err) {
    console.error("[deep-research] synthesis error:", err.message);
    synthesis = {};
  }

  return {
    success: true,
    data: Object.assign({}, synthesis || {}, {
      research_metadata: {
        question,
        depth,
        research_plan: effectivePlan,
        searches_performed: effectivePlan.length,
        total_sources: allSources.reduce((s, a) => s + a.results.length, 0),
        elapsed_ms: Date.now() - startTime,
        source_summary: allSources.map((a) => ({ query: a.query, result_count: a.results.length })),
      },
      disclaimer: "Research findings are based on publicly available web sources at the time of research. Information may change. Verify critical information against primary sources.",
    }),
    metadata: { completedAt: new Date().toISOString() },
  };
}
