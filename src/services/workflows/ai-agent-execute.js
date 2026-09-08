/**
 * AI Agent Task Executor — POST /api/agent/execute
 *
 * Takes a natural-language task, classifies it, estimates complexity,
 * plans and executes subtasks using a controlled tool registry, and returns
 * a structured result.
 *
 * Pricing tiers based on complexity: simple ($1.00), medium ($3.00),
 * complex ($10.00), premium ($25.00+).
 *
 * IMPORTANT: Controlled tool execution only. No arbitrary command execution.
 * All tools must be explicitly defined and permissioned.
 *
 * Without AI keys, falls back to heuristic classification + keyword-based planning.
 * With API keys, uses chatJson for planning + synthesis.
 */
import { enforceTimeout } from "../../lib/timing.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

// ── Cached tool resolver ──────────────────────────────────────────────────────
let _toolsReady = null;
async function getTools() {
  if (_toolsReady) return _toolsReady;
  const mod = await import("../../lib/workflow-utils.js");
  _toolsReady = {
    webSearch: mod.webSearch,
    scrape: mod.scrape,
    TOOL_REGISTRY: mod.TOOL_REGISTRY,
    runTool: mod.runTool,
    withConcurrency: mod.withConcurrency,
  };
  return _toolsReady;
}

// ── Complexity estimation (no AI required) ───────────────────────────────────
const COMPLEXITY_RULES = [
  { cat: "simple", maxTokens: 512, timeoutMs: 5000, priceTier: "$1.00", test: (t) => /\b(who|what|where|when|define|list|summarize|find|search|lookup|name)\b/i.test(t) && t.split(/\s+/).length < 20 },
  { cat: "medium", maxTokens: 1024, timeoutMs: 15000, priceTier: "$3.00", test: (t) => /\b(compare|analyze|research|investigate|explore|review|audit|check|scan|profile)\b/i.test(t) && t.split(/\s+/).length < 50 },
  { cat: "complex", maxTokens: 2048, timeoutMs: 30000, priceTier: "$10.00", test: (t) => /\b(deep|comprehensive|thorough|extensive|detailed|multi|step|plan|strategy|competitive|market)\b/i.test(t) },
  { cat: "premium", maxTokens: 4096, timeoutMs: 60000, priceTier: "$25.00+", test: (t) => t.split(/\s+/).length >= 50 || /\b(enterprise|full|end.to.end|complete|all|everything|entire)\b/i.test(t) },
];

function estimateComplexity(task) {
  const t = (task || "").trim();
  if (!t) return { category: "simple", config: { maxTokens: 256, timeoutMs: 3000, priceTier: "$1.00" } };
  for (const rule of COMPLEXITY_RULES) {
    if (rule.test(t)) return { category: rule.cat, config: { maxTokens: rule.maxTokens, timeoutMs: rule.timeoutMs, priceTier: rule.priceTier } };
  }
  return { category: "medium", config: { maxTokens: 1024, timeoutMs: 15000, priceTier: "$3.00" } };
}

// ── Heuristic plan generator (no AI needed) ───────────────────────────────────
function _norm(s) {
  return (s || "").replace(/_/g, "").replace(/-/g, "").toLowerCase();
}

function heuristicPlan(task, allowedTools, registry) {
  const t = (task || "").toLowerCase();
  const steps = [];
  const allowedNorm = new Set();
  if (allowedTools) {
    for (const a of allowedTools) allowedNorm.add(_norm(a));
  }
  const hasWebSearch = allowedTools ? allowedNorm.has(_norm("webSearch")) : true;
  const hasScrape = allowedTools ? allowedNorm.has(_norm("scrape")) : true;

  if (hasWebSearch && /\b(search|find|lookup|research|investigate|discover|explore|study|analyze|review|check|scan)\b/.test(t)) {
    steps.push({ tool: "webSearch", args: { query: task, maxResults: 5 }, description: "Web search for task context", essential: true });
  }
  if (hasScrape && /\b(scrape|visit|fetch|page|website|url|extract|read|parse|analyze site)\b/.test(t)) {
    const urlMatch = task.match(/https?:\/\/[^\s,;]+/);
    if (urlMatch) {
      steps.push({ tool: "scrape", args: { url: urlMatch[0] }, description: "Scrape referenced URL", essential: true });
    }
  }
  if (steps.length === 0 && hasWebSearch) {
    steps.push({ tool: "webSearch", args: { query: task, maxResults: 3 }, description: "Default context search", essential: true });
  }
  if (steps.length === 0) {
    steps.push({ tool: "webSearch", args: { query: task, maxResults: 3 }, description: "Fallback context search", essential: true });
  }
  return steps;
}

// ── Main handler ──────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT = 30_000;

export async function aiAgentExecute(input, req) {
  const { task, allowed_tools: allowedTools, max_steps: maxSteps = 15 } = input;

  if (!task || typeof task !== "string" || task.trim().length < 5) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"task" is required (at least 5 characters)' } };
  }

  const startTime = Date.now();
  const wrap = (data, ok = true) => ok
    ? { success: true, data, metadata: { completedAt: new Date().toISOString() } }
    : { success: false, data: { task, status: "failed", error: data?.error || "unknown", started_at: new Date(startTime).toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime }, metadata: { completedAt: new Date().toISOString() } };

  try {
    const tools = await getTools();
    const { webSearch, scrape, TOOL_REGISTRY, runTool, withConcurrency } = tools;

    // Step 1: Complexity estimation (sync, no AI)
    const complexity = estimateComplexity(task);

    // Step 2: Generate execution plan (AI if available, heuristic fallback)
    let plan;
    const hasAi = await chatJson([
      { role: "system", content: "Reply YES if you are available, NO otherwise." },
      { role: "user", content: "Are you available?" },
    ], { temperature: 0.1, max_tokens: 16 }).then(r => r && r.toString().toUpperCase().includes("YES")).catch(() => false);

    if (hasAi) {
      const planJson = await chatJson([
        { role: "system", content: "You are a task planner. Available tools: " + Object.keys(TOOL_REGISTRY).join(", ") + ". If allowed_tools is specified, use only those. Return a JSON array of steps. Each step: {tool, args, description, essential}. Return ONLY JSON." },
        { role: "user", content: "Task: " + task + "\nComplexity: " + JSON.stringify(complexity) + "\nallowed_tools: " + JSON.stringify(allowedTools || []) + "\nGenerate execution plan:" },
      ], { temperature: 0.2, max_tokens: 1024 });
      if (planJson && Array.isArray(planJson)) {
        plan = planJson;
      } else {
        plan = heuristicPlan(task, allowedTools, TOOL_REGISTRY);
      }
    } else {
      plan = heuristicPlan(task, allowedTools, TOOL_REGISTRY);
    }

    if (!Array.isArray(plan) || plan.length === 0) {
      plan = [{ tool: "webSearch", args: { query: task, maxResults: 3 }, description: "Default context search", essential: true }];
    }

    // Step 3: Execute plan
    const results = [];
    const timeoutPerStep = Math.min(complexity.config.timeoutMs, DEFAULT_TIMEOUT / Math.max(plan.length, 1));

    for (let i = 0; i < Math.min(plan.length, maxSteps); i++) {
      const step = plan[i];
      const stepNum = i + 1;

      try {
        // Resolve the canonical tool name (handles camelCase/snake_case matching)
        const stepToolRaw = step.tool;
        const stepToolKey = TOOL_REGISTRY[stepToolRaw] ? stepToolRaw
          : TOOL_REGISTRY[stepToolRaw.replace(/_/g, "")] ? stepToolRaw.replace(/_/g, "")
          : TOOL_REGISTRY[stepToolRaw.toLowerCase()] ? stepToolRaw.toLowerCase()
          : TOOL_REGISTRY[stepToolRaw.toLowerCase().replace(/_/g, "")] ? stepToolRaw.toLowerCase().replace(/_/g, "")
          : null;

        if (!stepToolKey) {
          throw new Error("Unknown tool: " + step.tool);
        }
        if (allowedTools) {
          // Normalize and check (camelCase/snake_case both accepted)
          const allowedNorm = new Set(allowedTools.map(t => {
            const n = (t || "").replace(/_/g, "").replace(/-/g, "").toLowerCase();
            return n;
          }));
          const stepNorm = (stepToolKey || "").replace(/_/g, "").replace(/-/g, "").toLowerCase();
          if (!allowedNorm.has(stepNorm)) {
            throw new Error("Tool not in allowed_tools: " + step.tool);
          }
        }
        const toolResult = await withConcurrency(async () =>
          enforceTimeout(timeoutPerStep + 2000, async () =>
            runTool(stepToolKey, step.args || {})
          )
        );

        results.push({ step: stepNum, tool: step.tool, description: step.description || "", status: "completed", result: toolResult });
      } catch (err) {
        results.push({ step: stepNum, tool: step.tool, description: step.description || "", status: "failed", error: err.message });

        if (step.essential) {
          return wrap({
            task,
            status: "failed",
            error: "Critical step failed: " + (step.description || step.tool) + " - " + err.message,
            results_so_far: results.filter((r) => r.status === "completed"),
            failed_step: { step: stepNum, tool: step.tool, error: err.message },
            started_at: new Date(startTime).toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }, false);
        }
      }

      await new Promise((r) => setTimeout(r, 150));
    }

    // Step 4: Synthesize
    let synthesis;
    const synthJson = await chatJson([
      { role: "system", content: "You are a result synthesizer. Produce final JSON with: summary, status, key_findings, failed_steps, next_steps, raw_results. Return ONLY JSON." },
      { role: "user", content: "Task: " + task + "\nResults:\n" + JSON.stringify(results, null, 2) + "\nSynthesize:" },
    ], { temperature: 0.1, max_tokens: 2048 });
    if (synthJson && typeof synthJson === "object") {
      synthesis = synthJson;
    } else {
      synthesis = {
        summary: "Task completed with " + results.filter((r) => r.status === "completed").length + " successful steps and " + results.filter((r) => r.status === "failed").length + " failed steps.",
        status: results.some((r) => r.status === "failed") ? "partial" : "completed",
        key_findings: results.filter((r) => r.status === "completed").map((r) => ({ step: r.step, tool: r.tool, result: r.result })),
        failed_steps: results.filter((r) => r.status === "failed").map((r) => ({ step: r.step, tool: r.tool, error: r.error })),
        next_steps: [],
        raw_results: results,
      };
    }

    return wrap({
      task,
      status: "completed",
      summary: synthesis.summary || "Task executed successfully",
      results: synthesis.raw_results || results.map((r) => ({
        step: r.step,
        tool: r.tool,
        description: r.description || "",
        status: r.status,
        result: r.result || null,
        error: r.error || null,
      })),
      complexity,
      classification: complexity.category,
      execution_metadata: {
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        steps_executed: results.length,
        steps_total: plan.length,
      },
    });
  } catch (err) {
    return wrap({
      task,
      status: "failed",
      error: err.message,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    }, false);
  }
}
