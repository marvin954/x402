/**
 * Invoice Extraction Workflow — POST /api/workflows/invoice-extract
 *
 * Extracts structured invoice data: vendor, invoice number, dates, currency,
 * subtotal, tax, total, and line items from uploaded invoices.
 */
import { extractTextFromFile } from "../../lib/workflow-utils.js";
import { enforceTimeout } from "../../lib/timing.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function invoiceExtract(input, req) {
  const file = input.file;
  const filename = input.filename || "invoice";
  const inputText = input.invoice_text || input.text || "";

  let buffer;
  let text;

  // If text provided directly, use it (overrides file)
  if (inputText && typeof inputText === "string" && inputText.trim().length >= 10) {
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
      text = await enforceTimeout(20_000, async () => extractTextFromFile(buffer, filename));
    } catch (err) {
      console.error("[invoice-extract] extraction error:", err.message);
      text = buffer.toString("utf8").slice(0, 15000);
    }
  }

  if (!text || text.trim().length < 10) {
    return { success: false, error: { code: "NO_TEXT", message: "Could not extract text from invoice" } };
  }

  const extracted = extractInvoiceFields(text);
  const enriched = await enrichWithAI(text, extracted);

  return enriched;
}

function clean(text) {
  return text?.replace(/\s+/g, " ").trim() || "";
}

function extractInvoiceFields(text) {
  return {
    vendor: extractField(text, /(?:vendor|from|bill from|supplier|shipper|sold by|company)\s*[:]?\s*([^\n]{2,80})/i, 60) || "",
    invoice_number: extractField(text, /invoice\s*(?:#|no\.?|number)?\s*[:#]?\s*([A-Z0-9_-]{3,30})/i, 30) || extractField(text, /inv\s*(?:#|no\.?)?\s*[:#]?\s*([A-Z0-9_-]{3,30})/i, 30) || "",
    invoice_date: extractField(text, /(?:invoice\s*)?date/i, 20) || "",
    due_date: extractField(text, /due\s*date|payment\s*due|net\s*\d+|payable\s*by/i, 20) || "",
    currency: extractCurrency(text),
    subtotal: extractAmount(text, /subtotal|amount\s*before\s*tax|before\s*tax|pre[- ]?tax|items?\s*total/i),
    tax: extractAmount(text, /tax(?:\s*amount)?|sales\s*tax|vat|gst|hst|tax\s*charge|tax\s*total/i),
    total: extractAmount(text, /(?:grand\s*)?total|amount\s*due|balance\s*due|billed\s*amount|final\s*total|total\s*due|amount\s*(?:paid|owed|due)/i),
    line_items: [],
    billing_address: extractField(text, /billing\s*address|bill\s*to/i, 150) || "",
    shipping_address: extractField(text, /shipping\s*address|ship\s*to|deliver\s*to/i, 150) || "",
    payment_terms: extractField(text, /payment\s*terms|terms?\s*and\s*conditions|net\s*\d+/i, 100) || "",
    raw_text_preview: text.slice(0, 3000),
    extraction_method: "regex_heuristic",
  };
}

function extractField(text, pattern, maxLen) {
  const m = text.match(pattern);
  if (m) {
    const idx = m.index;
    const start = Math.max(0, idx - 20);
    const end = Math.min(text.length, m[0].length + idx + 60);
    return clean(text.slice(start, end)).slice(0, maxLen);
  }
  return "";
}

/** Parse a number from text near a pattern match. */
function extractAmount(text, pattern) {
  const m = text.match(pattern);
  if (m) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    const amt = after.match(/[\$€£¥]?\s*[\d,]+\.\d{2}/);
    if (amt) return amt[0].replace(/\s/g, "");
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    const amt2 = before.match(/[\$€£¥]?\s*[\d,]+\.\d{2}/);
    if (amt2) return amt2[0].replace(/\s/g, "");
  }
  return "";
}

function extractCurrency(text) {
  if (/currenc?y\s*[:=]\s*(USD|EUR|GBP|CAD|AUD|JPY|CNY|INR)/i.test(text)) {
    return text.match(/currenc?y\s*[:=]\s*(USD|EUR|GBP|CAD|AUD|JPY|CNY|INR)/i)[1];
  }
  if (/\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  return "USD";
}

async function enrichWithAI(text, extracted) {
  const preview = text.slice(0, 8000);
  try {
    const ai = await chatJson([
      { role: "system", content: "You are an invoice extraction expert. Return ONLY valid JSON: {vendor, invoice_number, invoice_date, due_date, currency, subtotal (number), tax (number), total (number), line_items (array of {description, quantity, unit_price, amount}), billing_address, shipping_address, payment_terms}. Use null for fields not found." },
      { role: "user", content: "Extract invoice data from:\n\n" + preview + "\n\nReturn JSON." },
    ], { temperature: 0.1, max_tokens: 2048 });

    if (ai && typeof ai === "object") {
      if (ai.vendor && ai.vendor !== extracted.vendor) extracted.vendor = ai.vendor;
      if (ai.invoice_number && ai.invoice_number !== extracted.invoice_number) extracted.invoice_number = ai.invoice_number;
      if (ai.invoice_date && ai.invoice_date !== extracted.invoice_date) extracted.invoice_date = ai.invoice_date;
      if (ai.due_date && ai.due_date !== extracted.due_date) extracted.due_date = ai.due_date;
      if (ai.currency && ai.currency !== extracted.currency) extracted.currency = ai.currency;
      if (typeof ai.subtotal === "number" && !extracted.subtotal) extracted.subtotal = String(ai.subtotal);
      if (typeof ai.tax === "number" && !extracted.tax) extracted.tax = String(ai.tax);
      if (typeof ai.total === "number" && !extracted.total) extracted.total = String(ai.total);
      if (Array.isArray(ai.line_items) && ai.line_items.length > 0) extracted.line_items = ai.line_items;
      if (ai.billing_address && !extracted.billing_address) extracted.billing_address = ai.billing_address;
      if (ai.shipping_address && !extracted.shipping_address) extracted.shipping_address = ai.shipping_address;
      if (ai.payment_terms && !extracted.payment_terms) extracted.payment_terms = ai.payment_terms;
      extracted.enriched_by_ai = true;
      extracted.extraction_method = "ai_enriched";
    }
  } catch (err) {
    console.error("[invoice-extract] AI error:", err.message);
  }
  return extracted;
}
