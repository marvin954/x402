/**
 * OMIT Enrich Service — POST /api/workflows/omitempty-enrich
 *
 * Simple enrichment passthrough: accepts input, returns enriched result
 * with metadata. Uses mock AI when no API key configured.
 */
import { chat, chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function omittableEnrich(input, req) {
  const { text, entity_type, context } = input;

  if (!text || typeof text !== "string" || text.trim().length < 1) {
    return success(false, {
      error: {
        code: "VALIDATION_ERROR",
        message: '"text" is required (non-empty string)',
      },
    });
  }

  // Build enrichment messages
  const messages = [
    {
      role: "system",
      content: `You are an entity enrichment engine. Given a ${entity_type || "text"} passage,
enrich it with structured metadata: entity types, key facts, relationships, confidence scores.
Return JSON only: { entities: [{name, type, confidence}], facts: [...], summary: "..." }`,
    },
    { role: "user", content: text },
  ];

  // Call AI (mock when no key configured)
  let aiResult = null;
  try {
    aiResult = await chatJson(messages, {
      temperature: 0.1,
      max_tokens: 3000,
      timeout_seconds: 30,
    });
  } catch (e) {
    // Fall through to regex fallback
  }

  // Parse AI response or use regex fallback
  let structured = null;
  if (aiResult && typeof aiResult === "string") {
    try {
      const parsed = JSON.parse(aiResult);
      if (parsed && typeof parsed === "object") {
        structured = parsed;
      }
    } catch {
      // Not valid JSON — fall through to regex
    }
  }

  if (!structured) {
    // Regex-based enrichment fallback
    const entities = [];
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let m;
    while ((m = emailRegex.exec(text)) !== null) {
      entities.push({ name: m[0], type: "email", confidence: 0.95 });
    }
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    while ((m = phoneRegex.exec(text)) !== null) {
      entities.push({ name: m[0], type: "phone", confidence: 0.85 });
    }
    const urlRegex = /https?:\/\/[^\s]+/g;
    while ((m = urlRegex.exec(text)) !== null) {
      entities.push({ name: m[0], type: "url", confidence: 0.90 });
    }
    const nameRegex = /[A-Z][a-z]+ [A-Z][a-z]+/g;
    while ((m = nameRegex.exec(text)) !== null) {
      entities.push({ name: m[0], type: "person", confidence: 0.60 });
    }
    structured = {
      entities: entities.slice(0, 20),
      facts: [],
      summary: text.trim().slice(0, 200),
      enriched: true,
      method: "regex",
    };
  }

  return success(true, {
    data: {
      ...structured,
      metadata: {
        processed_at: new Date().toISOString(),
        entity_count: structured.entities?.length || 0,
        source: "omittable-enrich",
      },
    },
    meta: withMeta(
      {
        endpoint: "omitempty-enrich",
        version: "1.0.0",
        model: "gpt-4o-mini",
      },
      req,
      { entity_count: structured.entities?.length || 0, processed_at: new Date().toISOString() }
    ),
  });
}
