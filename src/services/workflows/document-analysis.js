/**
 * Document Intelligence Workflow — POST /api/workflows/document-analysis
 *
 * Extracts text from uploaded documents (PDF, text, invoices, business docs),
 * summarizes, identifies key entities, important dates, and action items.
 */
import { extractTextFromFile } from "../../lib/workflow-utils.js";
import { enforceTimeout } from "../../lib/timing.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function documentAnalysis(input, req) {
  const file = input.file;
  const filename = input.filename || "document";
  const document_type = input.document_type || "auto";
  const extract_text_only = input.extract_text_only;
  const inputText = input.document_text || input.text || "";

  let buffer;
  let text;

  // If text provided directly, use it (overrides file)
  if (inputText && typeof inputText === "string" && inputText.trim().length >= 20) {
    text = inputText.trim();
  } else if (file) {
    // Try to extract from file
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
      text = await enforceTimeout(20_000, async () => extractTextFromFile(buffer, filename));
    } catch (err) {
      console.error("[document-analysis] extraction error:", err.message);
      text = buffer.toString("utf8").slice(0, 15000);
    }
  }

  if (!text || text.trim().length < 20) {
    return { success: false, error: { code: "NO_TEXT", message: "Could not extract readable text from document" } };
  }

  const result = await analyzeDocument(text, document_type, filename);
  return { success: true, data: result, metadata: { completedAt: new Date().toISOString() } };
}

async function analyzeDocument(text, docType, filename) {
  const detectedType = detectDocumentType(text);
  const summary = await generateSummary(text, detectedType);
  const entities = extractEntities(text);
  const dates = extractDates(text);
  const actionItems = extractActionItems(text, summary);

  return {
    filename,
    file_size_bytes: text.length,
    document_type: docType === "auto" ? detectedType : docType,
    extracted_text_preview: text.slice(0, 2000),
    summary,
    key_entities: entities.slice(0, 30),
    important_dates: dates.slice(0, 15),
    action_items: actionItems.slice(0, 20),
    language: detectLanguage(text),
    confidence: estimateExtractionConfidence(text),
    extraction_method: "heuristic_with_ai_fallback",
  };
}

function detectDocumentType(text) {
  const l = text.toLowerCase();
  if (/(\binvoice\b|\binv\b|\binvoice no\.?\b|\binvoice date\b|\bamount due\b|\btotal\b)/i.test(l)) return "invoice";
  if (/(\bcontract\b|\bagreement\b|\bparties\b|\beffective date\b|\btermination\b|\bindemnif\b|\bconfidentiality\b)/i.test(l)) return "contract";
  if (/(\bmeeting\b|\bminutes\b|\battendees\b|\bagenda\b|\baction items?\b|\bnext steps?\b)/i.test(l)) return "meeting_notes";
  if (/(\bresume\b|\bcv\b|\bcurriculum\b|\bwork experience\b|\beducation\b|\bskills\b)/i.test(l)) return "resume";
  if (/(\breport\b|\banalysis\b|\bfindings\b|\bconclusion\b|\b executive summary\b)/i.test(l)) return "report";
  if (/(\bemail\b|\bsubject:\b|\bfrom:\b|\bto:\b|\bdear\b|\b regards\b)/i.test(l)) return "email";
  return "document";
}

async function generateSummary(text, docType) {
  const preview = text.slice(0, 8000);
  try {
    return await chatJson([
      { role: "system", content: "You are a document analysis expert. Return a JSON object with: summary (3-5 sentence summary), key_points (array of 3-5 main points), document_type (detected type). Only return valid JSON." },
      { role: "user", content: "Document type: " + docType + "\n\nDocument:\n\n" + preview + "\n\nSummarize and extract key points." },
    ], { temperature: 0.2, max_tokens: 1024 });
  } catch (err) {
    console.error("[document-analysis] summary AI error:", err.message);
    return fallbackSummary(text, docType);
  }
}

function fallbackSummary(text, docType) {
  const lines = text.split(/\n+/).filter((l) => l.trim().length > 10);
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    summary: docType + " document with approximately " + words + " words. Main topics: " + lines.slice(0, 2).map((l) => l.slice(0, 100)).join("; ") + ".",
    key_points: lines.slice(0, 5).map((l) => l.slice(0, 200)),
    document_type: docType,
  };
}

function extractEntities(text) {
  const entities = [];
  const types = [
    { type: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    { type: "phone", regex: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g },
    { type: "url", regex: /https?:\/\/[^\s<>"]+/g },
    { type: "date", regex: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\w*\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g },
    { type: "money", regex: /[$€£¥]\s*[\d,]+\.\d{2}/g },
    { type: "percentage", regex: /\b\d+\.?\d*%\b/g },
  ];
  for (const { type, regex } of types) {
    try {
      let m;
      while ((m = regex.exec(text)) !== null) {
        const val = m[0].trim();
        if (val && !entities.some((e) => e.type === type && e.value === val)) {
          entities.push({ type, value: val, context: extractContext(text, m.index, 50) });
        }
      }
    } catch (e) { /* regex may fail on short/empty text */ }
  }
  try {
    const nameRe = /(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+([A-Z][a-z]+ [A-Z][a-z]+)/g;
    let m;
    while ((m = nameRe.exec(text)) !== null) {
      if (!entities.some((e) => e.type === "person" && e.value === m[1])) {
        entities.push({ type: "person", value: m[1], context: extractContext(text, m.index, 50) });
      }
    }
  } catch (e) { /* skip */ }
  return entities.slice(0, 50);
}

function extractDates(text) {
  const dateRe = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\w*\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
  const dates = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    dates.push({ value: m[0], context: extractContext(text, m.index, 40) });
  }
  return dates.slice(0, 15);
}

function extractActionItems(text, summary) {
  const items = [];
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const l = line.toLowerCase().trim();
    if (/^(action item|todo|to-do|task|next step|follow[- ]?up|please |required|must |deadline|due by|due date|deliverable|submit|complete by|action required)/i.test(l) ||
        /^\d+[.)]\s*(action|todo|task|follow|deliver|submit|send|complete|review|approve|sign|confirm)/i.test(line)) {
      items.push({ text: line.trim().slice(0, 300), type: "action_item" });
    }
  }
  if (items.length === 0 && summary?.key_points?.length) {
    summary.key_points.forEach((p) => {
      if (/action|follow|submit|complete|review|approve|deliver|next/i.test(p)) {
        items.push({ text: p, type: "inferred" });
      }
    });
  }
  return items.slice(0, 20);
}

function extractContext(text, index, windowSize) {
  const start = Math.max(0, index - windowSize);
  const end = Math.min(text.length, index + windowSize);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function detectLanguage(text) {
  const l = text.toLowerCase();
  if (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/i.test(l)) return "likely_european";
  if (/[áéíóúñ]/i.test(l)) return "likely_spanish_portuguese";
  return "english_or_latin_script";
}

function estimateExtractionConfidence(text) {
  const textLen = text.length;
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
  const hasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(text);
  const hasMoney = /[$€£¥]\d/.test(text);
  let score = 50;
  if (textLen > 500) score += 10;
  if (textLen > 2000) score += 15;
  if (hasEmail) score += 10;
  if (hasDate) score += 10;
  if (hasMoney) score += 5;
  return Math.min(100, score);
}
