/**
 * workflow-utils.js — shared helpers for all workflow endpoints.
 *
 * Provides: chat/chatJson (AI calls with mock fallback), webSearch,
 * scrape, extractTextFromFile, withConcurrency, TOOL_REGISTRY, runTool,
 * estimateComplexity, COMPLEXITY, enforceTimeout/timed/sleep/clamp (re-exports).
 *
 * Provider contact: info@mammbaent.com
 */

// ── Timing re-exports ──────────────────────────────────────────────────────────
export { enforceTimeout, timed, sleep, clamp } from "./timing.js";

// ── AI helpers ──────────────────────────────────────────────────────────────────

/** Read AI config from env (API key + model). Returns null when unconfigured. */
function aiConfig() {
  const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY;
  const base = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || process.env.GEMINI_BASE_URL;
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  if (!key) return null;
  return { key, base, model };
}

/**
 * Call an AI chat API. Falls back to mock when no key configured.
 * Supports OpenAI-compatible endpoints (OpenAI, Anthropic via bedrock/gateway, Gemini, Mistral).
 */
export async function chat(messages, opts = {}) {
  const cfg = aiConfig();
  if (!cfg) {
    // Return a generic mock response so callers can degrade gracefully
    return "[mock] " + messages.map(m => (m.role === "user" ? m.content : "")).join(" ").slice(0, 200);
  }
  const { key, base, model } = cfg;
  const url = `${base}/chat/completions`;
  const body = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 1024,
    timeout: opts.timeoutMs ?? 30000,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`AI API error ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || "").trim();
  } catch (err) {
    console.error("[workflow-utils] chat error:", err.message);
    return "[mock-fallback] " + messages.map(m => (m.role === "user" ? m.content : "")).join(" ").slice(0, 150);
  }
}

/**
 * Call AI and parse the response as JSON. Returns null on failure.
 * This is the primary AI entry point for all workflow services.
 */
export async function chatJson(messages, opts = {}) {
  const text = await chat(messages, { ...opts, temperature: opts.temperature ?? 0.2 }).catch((err) => {
    console.error("[workflow-utils] chatJson.chat error:", err?.message || err);
    return null;
  });
  if (!text) return null;
  // strip markdown fences
  const cleaned = text.replace(/```(?:json)?\s*/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      try { return JSON.parse(cleaned); } catch { return null; }
    }
  }
  // try the whole cleaned string
  try { return JSON.parse(cleaned); } catch { return null; }
}

// ── Web search (DuckDuckGo HTML) with mock fallback ────────────────────────────

/**
 * Web search via DuckDuckGo HTML scraping. Falls back to mock results when
 * no network or scraping fails. Returns array of { title, url, snippet }.
 */
export async function webSearch(query, opts = {}) {
  const maxResults = opts.maxResults ?? 5;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return [];
  }

  // Try DuckDuckGo HTML version
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MAMMBA-Workflow/1.0)" },
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`DDG status ${res.status}`);
    const html = await res.text();
    return parseDdgHtml(html, maxResults);
  } catch (err) {
    console.error("[workflow-utils] webSearch DDG error:", err.message);
    // Fallback: Google
    try {
      const gurl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(maxResults + 5, 20)}`;
      const gres = await fetch(gurl, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
        signal: opts.signal,
      });
      if (!gres.ok) throw new Error(`Google status ${gres.status}`);
      return parseGoogleHtml(await gres.text(), maxResults);
    } catch (gerr) {
      console.error("[workflow-utils] webSearch Google error:", gerr.message);
      return mockSearchResults(query, maxResults);
    }
  }
}

function parseDdgHtml(html, max) {
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = regex.exec(html)) && results.length < max) {
    try {
      const title = decodeHtml(m[2]);
      const href = m[1];
      // DDG wraps real URLs in redirect links
      const u = href.startsWith("//duckduckgo.com/l/?uddg=") ? decodeURIComponent(href.match(/uddg=([^&]+)/)?.[1] || href) : href;
      const snippet = decodeHtml(m[3]).slice(0, 300);
      if (u && u.startsWith("http")) results.push({ title, url: u, snippet });
    } catch { /* skip malformed */ }
  }
  return results.length ? results : mockSearchResults(query, max);
}

function parseGoogleHtml(html, max) {
  const results = [];
  const regex = /<h3[^>]*>(.*?)<\/h3>.*?<a[^>]*href="([^"]+)"[^>]*>.*?<span[^>]*class="aCOpRe"[^>]*>(.*?)<\/span>/gis;
  let m;
  while ((m = regex.exec(html)) && results.length < max) {
    try {
      results.push({ title: decodeHtml(m[1]).slice(0, 150), url: m[2], snippet: decodeHtml(m[3]).slice(0, 300) });
    } catch { /* skip */ }
  }
  return results.length ? results : mockSearchResults(query, max);
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, (_, n) => String.fromCharCode(+n));
}

function mockSearchResults(query, max) {
  const terms = query.split(/\s+/).filter(Boolean);
  return Array.from({ length: Math.min(max, 5) }, (_, i) => ({
    title: `${query} - Result ${i + 1}`,
    url: `https://example.com/result/${i + 1}`,
    snippet: `Mock search result for: "${query}". This is a simulated result when no search API is available.` +
      (terms.length ? ` Keywords: ${terms.slice(0, 3).join(", ")}.` : ""),
  }));
}

// ── URL scraper with mock fallback ─────────────────────────────────────────────

/**
 * Scrape a URL and return extracted text content. Falls back to mock when
 * the URL is unreachable or scraping fails.
 */
export async function scrape(url, opts = {}) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return `[mock] Scraped content for: ${url}`;
  }
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MAMMBA-Workflow/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return extractTextFromHtml(html);
  } catch (err) {
    console.error("[workflow-utils] scrape error:", err.message);
    return `[mock] Scraped page content for ${url} - ${err.message.slice(0, 100)}`;
  }
}

function extractTextFromHtml(html) {
  // Remove scripts, styles, nav, headers, footers
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, " ");
  // Replace block elements with newlines
  const text = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 50000);
}

// ── Document text extraction ────────────────────────────────────────────────────

/**
 * Extract readable text from a Buffer (PDF or text file).
 * Falls back to raw buffer text for unknown formats.
 */
export async function extractTextFromFile(buffer, filename = "document") {
  if (!buffer) return "";
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length === 0) return "";

  const ext = (filename || "").toLowerCase().split(".").pop() || "";

  // Plain text
  if (["txt", "csv", "json", "md", "log", "xml", "html", "htm"].includes(ext)) {
    return buf.toString("utf8").slice(0, 100_000);
  }

  // PDF
  if (ext === "pdf") {
    return await extractTextFromPdf(buf);
  }

  // Fallback: try as text
  try {
    const asText = buf.toString("utf8");
    if (asText.trim().length > 10) return asText.slice(0, 100_000);
  } catch { /* not text */ }

  return `[Unable to extract text from ${filename} — unsupported format or encrypted]`;
}

function extractTextFromPdf(buffer) {
  // Minimal PDF text extractor — finds stream content between BT/ET markers
  try {
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder().decode(bytes);
    // Find all text between BT and ET
    const texts = [];
    let pos = 0;
    while (true) {
      const bt = str.indexOf("BT", pos);
      if (bt < 0) break;
      const et = str.indexOf("ET", bt + 2);
      if (et < 0) break;
      const chunk = str.slice(bt, et + 2);
      // Extract text between parentheses in Tf/Tj/TJ operators
      const fontRe = /\/(\w+)\s+Tf/g;
      const textRe = /\(\s*([^)]*)\)\s*Tj/g;
      let tm;
      while ((tm = textRe.exec(chunk)) !== null) {
        const t = tm[1].replace(/\\(.)/g, "$1");
        if (t.trim()) texts.push(t);
      }
      pos = et + 2;
    }
    if (texts.length) {
      return texts.join(" ").replace(/\s+/g, " ").trim();
    }
    // Fallback: return raw text between stream/endstream
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    const streams = [];
    let sm;
    while ((sm = streamRe.exec(str)) !== null) {
      streams.push(sm[1]);
    }
    if (streams.length) {
      const raw = streams.join("\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
      return raw.slice(0, 50000);
    }
    return "[PDF text extraction unavailable — encrypted or scanned document]";
  } catch (err) {
    return `[PDF extraction error: ${err.message}]`;
  }
}

// ── Concurrency limiter ─────────────────────────────────────────────────────────

const _concurrencyMap = new Map();

/**
 * Run `fn` with a per-key concurrency limit. Waits if the limit is reached.
 * Useful for limiting parallel web requests per workflow invocation.
 */
export async function withConcurrency(fn, opts = {}) {
  const key = opts.key ?? "default";
  const limit = opts.limit ?? 5;
  const map = _concurrencyMap;
  if (!map.has(key)) map.set(key, { count: 0, queue: [] });

  return new Promise((resolve, reject) => {
    const entry = map.get(key);
    const run = () => {
      entry.count++;
      Promise.resolve(fn()).then((result) => {
        entry.count--;
        if (entry.queue.length) entry.queue.shift()();
        resolve(result);
      }).catch((err) => {
        entry.count--;
        if (entry.queue.length) entry.queue.shift()();
        reject(err);
      });
    };
    if (entry.count < limit) {
      run();
    } else {
      entry.queue.push(run);
    }
  });
}

// ── Tool registry (AI agent executor) ──────────────────────────────────────────

/** Lightweight tool registry for the AI agent executor. */
export const TOOL_REGISTRY = {
  webSearch: {
    name: "webSearch",
    description: "Search the web for information",
    fn: async (args) => {
      const results = await webSearch(args.query || "", { maxResults: args.maxResults ?? 5 });
      return { query: args.query, results, count: results.length };
    },
  },
  scrape: {
    name: "scrape",
    description: "Scrape content from a URL",
    fn: async (args) => {
      const text = await scrape(args.url || "", {});
      return { url: args.url, content: text.slice(0, 10000), length: text.length };
    },
  },
  extractText: {
    name: "extractText",
    description: "Extract text from a document buffer",
    fn: async (args) => {
      const text = await extractTextFromFile(args.buffer, args.filename || "doc");
      return { filename: args.filename, text: text.slice(0, 5000), length: text.length };
    },
  },
};

/**
 * Execute a named tool with args. Throws if unknown.
 */
export async function runTool(name, args = {}) {
  const tool = TOOL_REGISTRY[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.fn(args);
}

// ── Complexity estimation ───────────────────────────────────────────────────────

/** Complexity tiers used by the AI agent executor. */
export const COMPLEXITY = {
  simple: { maxSteps: 3, timeoutMs: 10000, label: "Simple" },
  medium: { maxSteps: 8, timeoutMs: 30000, label: "Medium" },
  complex: { maxSteps: 15, timeoutMs: 90000, label: "Complex" },
  premium: { maxSteps: 25, timeoutMs: 180000, label: "Premium" },
};

/**
 * Estimate task complexity from a natural-language description.
 * Returns a complexity tier + config without calling AI.
 */
export function estimateComplexity(task) {
  const t = (task || "").trim().toLowerCase();
  if (!t) return { tier: "simple", config: COMPLEXITY.simple, score: 0 };

  let score = 0;
  // Simple signals
  if (/^(what|who|where|when|define|list|find|name|get|lookup)\b/.test(t)) score += 1;
  if (t.split(/\s+/).length < 10) score += 1;
  // Medium signals
  if (/^(compare|analyze|research|investigate|review|audit|check|scan|profile|explore)\b/.test(t)) score += 3;
  if (t.split(/\s+/).length >= 10 && t.split(/\s+/).length < 25) score += 2;
  // Complex signals
  if (/^(deep|comprehensive|thorough|extensive|detailed|multi.?step|plan|strategy|competitive|market)\b/.test(t)) score += 5;
  if (t.split(/\s+/).length >= 25) score += 3;
  // Premium signals
  if (t.split(/\s+/).length >= 40) score += 4;
  if (/^(enterprise|full|end.to.end|complete|all|everything|entire)\b/.test(t)) score += 4;

  const tier = score >= 8 ? "complex" : score >= 4 ? "medium" : score >= 1 ? "medium" : "simple";
  return { tier, config: COMPLEXITY[tier], score };
}
