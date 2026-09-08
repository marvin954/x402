
/**
 * Lead Extraction Workflow — POST /api/workflows/lead-extraction
 *
 * Extracts qualified leads from unstructured text (webpage content, email threads,
 * social posts, CRM notes). Parses names, companies, contact info, pain points,
 * and budget signals. Returns structured lead profiles with confidence scores.
 */
import { scrape, chatJson, withConcurrency } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function leadExtraction(body, req) {
  const source_url = body.source_url || body.url;
  const text = body.text || body.content || body.raw_text;

  if (!source_url && !text) {
    return success(false, {
      error: { code: "VALIDATION_ERROR", message: '"source_url" or "text" is required' }
    });
  }

  let content = text;
  let source = "text";

  // If we have a URL, scrape it first
  if (source_url) {
    try {
      const scraped = await scrape(source_url);
      content = scraped.content || scraped.text || "";
      source = "scraped:" + (source_url || "unknown");
      if (!content || content.length < 50) {
        content = text || "";
        source = text ? "text" : "scraped:" + (source_url || "unknown");
      }
    } catch (e) {
      // Scrape failed — fall back to text if provided, else error
      if (!text) {
        return success(false, {
          error: { code: "SCRAPE_FAILED", message: `Could not scrape ${source_url}: ${e.message}` }
        });
      }
      content = text;
      source = "text";
    }
  }

  if (!content || content.length < 20) {
    return success(false, {
      error: { code: "VALIDATION_ERROR", message: "Insufficient content to extract leads from" }
    });
  }

  // Truncate to fit in context
  const truncated = content.slice(0, 8000);

  const messages = [
    {
      role: "system",
      content: `You are a lead extraction expert. Extract ALL potential leads from the provided text.

For each lead found, return a JSON array of objects with these fields:
- name: person's full name (or company name if no person)
- email: email address if found (else null)
- phone: phone number if found (else null)
- company: company/organization name
- title: job title or role
- location: city/region if mentioned
- budget_signal: any mention of budget, spending, "looking to hire", "requesting quote", etc.
- pain_point: the problem or need expressed
- source_context: brief context of where this lead appeared (e.g. "requesting quote for roofing work")
- confidence: 0.0-1.0 based on how complete the information is
- priority: "high" | "medium" | "low" — high if budget signal + contact info present

Return ONLY a valid JSON array. No markdown, no explanation.`
    },
    { role: "user", content: `Extract leads from this content:\n\n=== CONTENT ===\n${truncated}\n=== END ===\n\nReturn a JSON array of lead objects.` }
  ];

  let chatResult;
  try {
    chatResult = await chatJson(messages, {
      temperature: 0.2,
      max_tokens: 4000,
      timeout_seconds: 30,
    });
  } catch (e) {
    return success(false, {
      error: { code: "AI_UNAVAILABLE", message: "AI service unavailable for lead extraction" }
    });
  }

  let parsed = [];

  // Parse AI response if available
  if (chatResult && typeof chatResult === "string" && chatResult.trim().length > 0) {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = chatResult.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(chatResult);
      }
    } catch (e) {
      // Try line-by-line extraction as fallback
      try {
        const lines = chatResult.split("\n").filter(l => l.trim());
        parsed = lines.map(l => {
          try { return JSON.parse(l.trim()); } catch { return null; }
        }).filter(Boolean);
      } catch {
        return success(false, {
          error: { code: "PARSE_ERROR", message: "Could not parse lead extraction output" }
        });
      }
    }
  }

  // Fallback: if AI returned nothing (null/mock mode), extract leads via regex from the text
  if (!Array.isArray(parsed) || parsed.length === 0) {
    const textToParse = truncated;
    const leads = [];

    // Extract emails
    const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;
    let emailMatch;
    while ((emailMatch = emailRegex.exec(textToParse)) !== null) {
      leads.push({ email: emailMatch[0].toLowerCase(), confidence: 0.9, priority: "medium", source_context: "email found in content" });
    }

    // Extract phone numbers (US format)
    const phoneRegex = /(?:[\+]?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    let phoneMatch;
    while ((phoneMatch = phoneRegex.exec(textToParse)) !== null) {
      const phone = phoneMatch[0].replace(/[^\d+]/g, '');
      leads.push({ phone, confidence: 0.85, priority: "medium", source_context: "phone found in content" });
    }

    // Extract name patterns (Title Case names followed by company)
    const namePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:at|from|of|with|@)\s+([A-Z][a-zA-Z0-9\s&]+?)(?:[\.,]|$)/g;
    let nameMatch;
    while ((nameMatch = namePattern.exec(textToParse)) !== null) {
      leads.push({
        name: nameMatch[1],
        company: nameMatch[2].trim(),
        confidence: 0.7,
        priority: "medium",
        source_context: "name + company pattern found in content"
      });
    }

    // Extract budget signals
    const budgetRegex = /(\$[\d,]+(?:\s*(?:budget|quote|estimate|spend|investment|investment))?|budget[:\s]+\$[\d,]+|budget[:\s]+\$[\d,]+)/gi;
    let budgetMatch;
    while ((budgetMatch = budgetRegex.exec(textToParse)) !== null) {
      if (leads.length > 0) {
        leads[0].budget_signal = budgetMatch[0];
        leads[0].priority = "high";
      }
    }

    // Extract pain points: sentences containing "needs", "looking for", "wants", "require", "requesting"
    const painPointRegex = /(?:needs|is looking for|wants|requires|requesting|seeking|looking to)\s+(?:a|an|the|new|replace|repair|service|quote|help|assistance)[^\n.!?]*/gi;
    let painMatch;
    while ((painMatch = painPointRegex.exec(textToParse)) !== null) {
      if (leads.length > 0 && !leads[0].pain_point) {
        leads[0].pain_point = painMatch[0].trim();
      }
    }

    // Deduplicate by email/phone
    const seen = new Set();
    parsed = leads.filter(l => {
      const key = l.email || l.phone || (l.name + (l.company || ""));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return success(false, {
      error: { code: "NO_LEADS_FOUND", message: "No leads could be extracted from the provided content" }
    });
  }

  // Normalize and score
  const leads = parsed.map(lead => ({
    name: lead.name || null,
    email: lead.email || null,
    phone: lead.phone || null,
    company: lead.company || null,
    title: lead.title || null,
    location: lead.location || null,
    budget_signal: lead.budget_signal || null,
    pain_point: lead.pain_point || null,
    source_context: lead.source_context || null,
    confidence: typeof lead.confidence === "number" ? Math.min(1, Math.max(0, lead.confidence)) : 0.5,
    priority: ["high", "medium", "low"].includes(lead.priority) ? lead.priority : "medium",
    extracted_at: new Date().toISOString(),
  }));

  // Sort by priority then confidence
  const priorityRank = { high: 0, medium: 1, low: 2 };
  leads.sort((a, b) => (priorityRank[a.priority] - priorityRank[b.priority]) || (b.confidence - a.confidence));

  return success(true, {
    leads,
    source,
    total: leads.length,
    high_priority: leads.filter(l => l.priority === "high").length,
    meta: { workflow: "lead-extraction", version: "1.0" }
  });
}
