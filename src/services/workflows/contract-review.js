/**
 * Contract Analysis Workflow — POST /api/workflows/contract-review
 *
 * Summarizes contracts, identifies parties, obligations, dates, payment terms,
 * termination terms, and important clauses. Returns informational analysis
 * with a clear legal disclaimer.
 *
 * IMPORTANT: This is informational only — NOT legal advice.
 */
import { extractTextFromFile } from "../../lib/workflow-utils.js";
import { enforceTimeout } from "../../lib/timing.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function contractReview(input, req) {
  const file = input.file;
  const filename = input.filename || "contract";
  const inputText = input.contract_text || input.text || "";

  let buffer;
  let text;

  // If text provided directly, use it (overrides file)
  if (inputText && typeof inputText === "string" && inputText.trim().length >= 50) {
    text = inputText.trim();
  } else if (file) {
    if (typeof file === "string" && file.startsWith("data:")) {
      const comma = file.indexOf(",");
      if (comma < 0) return { success: false, error: { code: "VALIDATION_ERROR", message: "data URI malformed" } };
      const b64 = file.slice(comma + 1);
      try { buffer = Buffer.from(b64, "base64"); } catch { return { success: false, error: { code: "VALIDATION_ERROR", message: "base64 decode failed" } }; }
      if (buffer.length > 10_000_000) return { success: false, error: { code: "VALIDATION_ERROR", message: "File too large — max 10MB" } };
    } else if (Buffer.isBuffer(file) || file instanceof Uint8Array) {
      buffer = Buffer.from(file);
      if (buffer.length > 10_000_000) return { success: false, error: { code: "VALIDATION_ERROR", message: "File too large — max 10MB" } };
    } else {
      return { success: false, error: { code: "VALIDATION_ERROR", message: '"file" must be Buffer, Uint8Array, or data URI' } };
    }
    try {
      text = await enforceTimeout(25_000, async () => extractTextFromFile(buffer, filename));
    } catch (err) {
      console.error("[contract-review] extraction error:", err.message);
      text = buffer.toString("utf8").slice(0, 20000);
    }
  }

  if (!text || text.trim().length < 50) {
    return { success: false, error: { code: "NO_TEXT", message: "Could not extract enough text — document may be image-only" } };
  }

  const result = await analyzeContract(text);
  result.disclaimer = "IMPORTANT: This analysis is informational only and is NOT legal advice. Consult a qualified attorney for professional legal review of any contract. AI-generated summaries may miss important nuances — always read the original document.";

  return { success: true, data: result, metadata: { completedAt: new Date().toISOString() } };
}

async function analyzeContract(text) {
  const preview = text.slice(0, 12000);
  try {
    const analysis = await chatJson([
      { role: "system", content: "You are a contract analysis assistant. Return ONLY valid JSON: {summary (2-3 sentences), parties (array of {name, role}), effective_date (string or null), termination ({notice_period, conditions, summary} or null), payment_terms ({amount, frequency, due_date, method, summary} or null), key_obligations (array of {party, obligation}), important_clauses (array of {clause_type, summary}), questions_for_review (array of 5-10 questions for a lawyer). Use null for fields you cannot determine. Always recommend professional legal review." },
      { role: "user", content: "Analyze this contract:\n\n" + preview + "\n\nReturn JSON analysis." },
    ], { temperature: 0.2, max_tokens: 4096 });

    if (analysis) {
      analysis.analyzed_at = new Date().toISOString();
      analysis.text_length = text.length;
      analysis.page_estimate = Math.ceil(text.length / 3000);
    }
    return analysis || { summary: "Contract document — see disclaimer" };
  } catch (err) {
    console.error("[contract-review] AI analysis error:", err.message);
    return fallbackContractAnalysis(text);
  }
}

function fallbackContractAnalysis(text) {
  const l = text.toLowerCase();
  const parties = [];
  const partyMatch = text.match(/(?:between|by and between)\s+(?:the\s+)?(.+?)(?:\s+and\s+)(?:the\s+)?(.+?)(?:\.|,|\n)/i);
  if (partyMatch) {
    parties.push({ name: partyMatch[1].trim().slice(0, 100), role: "Party A" });
    parties.push({ name: partyMatch[2].trim().slice(0, 100), role: "Party B" });
  }

  const clauses = [];
  const clausePatterns = [
    { type: "Confidentiality", pattern: /confidential/i },
    { type: "Intellectual Property", pattern: /intellectual property|ip rights|work for hire|ownership of/i },
    { type: "Indemnification", pattern: /indemnif/i },
    { type: "Limitation of Liability", pattern: /limitation of liability|liability cap|damages shall be/i },
    { type: "Termination", pattern: /termination|terminate|ends?/i },
    { type: "Non-Compete", pattern: /non[- ]?compete|exclusive\b/i },
    { type: "Governing Law", pattern: /governing law|jurisdiction|venue/i },
    { type: "Arbitration", pattern: /arbitration|arbitrate/i },
    { type: "Force Majeure", pattern: /force majeure|act of god/i },
    { type: "Assignment", pattern: /assign|assignment|transfer/i },
    { type: "Auto-Renewal", pattern: /auto[- ]?renew|automatic(?:ally)? renew|renew(?:al)?\s+term/i },
    { type: "Insurance", pattern: /insurance|liable for/i },
  ];
  for (const { type, pattern } of clausePatterns) {
    if (pattern.test(l)) {
      const idx = l.search(pattern);
      const snippet = text.slice(Math.max(0, idx - 50), Math.min(text.length, idx + 200));
      clauses.push({ clause_type: type, summary: snippet.replace(/\s+/g, " ").trim().slice(0, 200) });
    }
  }

  return {
    summary: "Contract document between " + (parties.map((p) => p.name).join(" and ") || "the identified parties") + ". " + (clauses.length > 0 ? clauses.length + " notable clauses identified: " + clauses.map((c) => c.clause_type).join(", ") + "." : "Standard clauses not easily identified — full document review recommended."),
    parties: parties.length ? parties : [{ name: "Unknown — review document", role: "Party A" }, { name: "Unknown — review document", role: "Party B" }],
    effective_date: findDate(text, /(effective date|commencement|start date|begin)/i),
    termination: l.includes("termination") ? { notice_period: extractNoticePeriod(l), conditions: "See full text", summary: "Termination provisions present — review for notice period, conditions, and consequences" } : null,
    payment_terms: l.includes("payment") || l.includes("fee") || l.includes("$") ? { amount: extractPaymentAmount(text), frequency: extractPaymentFrequency(l), due_date: findDate(text, /(due date|payment due|net \d+)/i), method: extractPaymentMethod(l), summary: "Payment terms present — review full text for details" } : null,
    key_obligations: parties.map((p) => ({ party: p.name, obligation: "Review the full contract for " + p.role + "'s specific obligations" })),
    important_clauses: clauses.length ? clauses : [{ clause_type: "Full document review needed", summary: "Standard clauses not clearly identified — read the complete document" }],
    questions_for_review: [
      "Are all parties correctly identified with legal names and addresses?",
      "What are the specific obligations of each party?",
      "What are the payment terms — amount, due date, and method?",
      "Can either party terminate at will, and what is the notice period?",
      "Are there any automatic renewal provisions?",
      "Who owns intellectual property created under this agreement?",
      "Is there a liability cap, and is it reasonable?",
      "How are disputes resolved — litigation, arbitration, or mediation?",
      "What law governs this contract, and where would disputes be heard?",
      "Are there any unusual or non-standard clauses that need explanation?",
    ],
    disclaimer: "This analysis is informational only and is NOT legal advice.",
    analyzed_at: new Date().toISOString(),
    text_length: text.length,
    page_estimate: Math.ceil(text.length / 3000),
  };
}

function findDate(text, pattern) {
  const m = text.match(pattern);
  if (m) {
    const idx = m.index;
    const window = text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + 100));
    const dateMatch = window.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i);
    if (dateMatch) return dateMatch[0];
  }
  return null;
}

function extractNoticePeriod(l) {
  const m = l.match(/notice\s*(?:period|of\s*)?[\s:]?\s*(\d+)/i);
  return m ? m[1] + " days" : "See full text";
}

function extractPaymentAmount(text) {
  const m = text.match(/(?:total|fee|price|cost|amount)[\s:]*[$€£¥]?\s*([\d,]+\.\d{2})/i);
  return m ? m[1] : "See full text";
}

function extractPaymentFrequency(l) {
  if (/monthly|per\s*month|each\s*(?:month|calendar)/i.test(l)) return "Monthly";
  if (/annual|per\s*year|each\s*year| yearly/i.test(l)) return "Annual";
  if (/weekly|per\s*week/i.test(l)) return "Weekly";
  if (/hourly|per\s*hour/i.test(l)) return "Hourly";
  if (/one[- ]?time|single|lump\s*sum/i.test(l)) return "One-time";
  return "See full text";
}

function extractPaymentMethod(l) {
  if (/wire|bank\s*transfer|ach/i.test(l)) return "Bank transfer/Wire";
  if (/check|cheque/i.test(l)) return "Check";
  if (/paypal|stripe|credit\s*card|debit\s*card/i.test(l)) return "Card online payment";
  if (/cash/i.test(l)) return "Cash";
  return "See full text";
}
