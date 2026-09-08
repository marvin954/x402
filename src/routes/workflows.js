/**
 * Workflow Router — /api/workflows/*
 *
 * All 20 workflow endpoints + AI agent executor mounted here.
 */
import { Router } from "express";
import { requirePayment } from "../middleware/x402.js";
import { endpoints } from "../db/queries.js";
import {
  validateDocumentFile, validateContractFile, validateIndustry,
  validateLocation, validatePositiveInt, validateRange,
  validateUrl, validateNonEmptyString, validateEnum,
} from "../lib/validation.js";
import { errorResponse, _meta } from "../lib/response.js";
import { omittableEnrich } from "../services/workflows/omitempty-enrich.js";

import { leadResearch } from "../services/workflows/lead-research.js";
import { leadExtraction } from "../services/workflows/lead-extraction.js";
import { websiteAudit } from "../services/workflows/website-audit.js";
import { salesProspect } from "../services/workflows/sales-prospect.js";
import { competitorAnalysis } from "../services/workflows/competitor-analysis.js";
import { marketResearch } from "../services/workflows/market-research.js";
import { contentFactory } from "../services/workflows/content-factory.js";
import { seoContent } from "../services/workflows/seo-content.js";
import { contactEnrichment } from "../services/workflows/contact-enrichment.js";
import { reputationCheck } from "../services/workflows/reputation-check.js";
import { proposalGenerator } from "../services/workflows/proposal-generator.js";
import { businessBlueprint } from "../services/workflows/business-blueprint.js";
import { documentAnalysis } from "../services/workflows/document-analysis.js";
import { invoiceExtract } from "../services/workflows/invoice-extract.js";
import { contractReview } from "../services/workflows/contract-review.js";
import { deepResearch } from "../services/workflows/deep-research.js";
import { dueDiligence } from "../services/workflows/due-diligence.js";
import { socialAnalysis } from "../services/workflows/social-analysis.js";
import { candidateAnalysis } from "../services/workflows/candidate-analysis.js";
import { businessEmail } from "../services/workflows/business-email.js";
import { aiAgentExecute } from "../services/workflows/ai-agent-execute.js";

const router = Router();

function findEndpoint(slug) {
  return endpoints?.findBySlug?.(slug) ||
    seedEndpoints?.find(e => e.slug === slug) ||
    null;
}

function paymentDenied(res, endpoint, scheme) {
  const hint = endpoint?.pricing_hint || "Include x402 payment headers.";
  const body = JSON.stringify({ error: "payment_required", message: hint, endpoint: endpoint?.slug });
  res.set("Content-Type", "application/json");
  if (scheme === "v2") {
    res.set("PAYMENT-REQUIRED", "true");
    res.set("PAYMENT-SIGNATURE", "");
  } else {
    res.set("X-PAYMENT-REQUIRED", "true");
  }
  return res.status(402).send(body);
}

// ────────────────────────────────────────────────────────────────
// 1. Lead Research
// ────────────────────────────────────────────────────────────────
router.post("/lead-research", async (req, res) => {
  try {
    const body = req.body || {};
    const valid = validateIndustry(body.industry) && validateLocation(body.location) && validatePositiveInt(body.count, 1, 100);
    if (!valid) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Valid "industry" (string) and "location" (string) are required. "count" must be 1-100.' } });
    }
    const result = await _meta(req, "lead-research", () => leadResearch(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 2. Website Audit
// ────────────────────────────────────────────────────────────────
router.post("/website-audit", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept either url or target_url — normalize into body.url for service
    const targetUrl = body.target_url || body.url;
    if (!targetUrl || typeof targetUrl !== "string" || targetUrl.trim().length < 5) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"url" is required and must be a valid URL string' } });
    }
    body.url = targetUrl;  // normalize so service destructuring gets url
    const result = await _meta(req, "website-audit", () => websiteAudit(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 3. Sales Prospecting
// ────────────────────────────────────────────────────────────────
router.post("/sales-prospect", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.industry || typeof body.industry !== "string" || body.industry.trim().length < 2) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"industry" is required (string, min 2 chars)' } });
    }
    if (!body.location || typeof body.location !== "string" || body.location.trim().length < 2) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"location" is required (string, min 2 chars)' } });
    }
    const result = await _meta(req, "sales-prospect", () => salesProspect(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 4. Competitor Analysis
// ────────────────────────────────────────────────────────────────
router.post("/competitor-analysis", async (req, res) => {
  try {
    const body = req.body || {};
    const valid = validateNonEmptyString(body.business_name || body.target_business || body.business) && validateUrl(body.business_url || body.url || body.website);
    if (!valid) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Valid "business_name" (string) is required. "business_url" is optional.' } });
    }
    const result = await _meta(req, "competitor-analysis", () => competitorAnalysis(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 5. Market Research
// ────────────────────────────────────────────────────────────────
router.post("/market-research", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.industry || typeof body.industry !== "string" || body.industry.trim().length < 2) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"industry" is required (string, min 2 chars)' } });
    }
    const result = await _meta(req, "market-research", () => marketResearch(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 6. Content Factory
// ────────────────────────────────────────────────────────────────
router.post("/content-factory", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.topic || typeof body.topic !== "string" || body.topic.trim().length < 5) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"topic" is required (string, min 5 chars)' } });
    }
    const result = await _meta(req, "content-factory", () => contentFactory(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 7. SEO Content Pipeline
// ────────────────────────────────────────────────────────────────
router.post("/seo-content", async (req, res) => {
  try {
    const body = req.body || {};
    const keyword = body.keyword || body.primary_keyword;
    if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"keyword" or "primary_keyword" is required (string, min 2 chars)' } });
    }
    const result = await _meta(req, "seo-content", () => seoContent(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 8. Contact Enrichment
// ────────────────────────────────────────────────────────────────
router.post("/contact-enrichment", async (req, res) => {
  try {
    const body = req.body || {};
    const company = body.company_name || body.company || (body.contact_info && typeof body.contact_info === "object" ? (body.contact_info.company || body.contact_info.name || null) : null);
    const website = body.website || (body.contact_info && typeof body.contact_info === "object" ? body.contact_info.website || null : null);
    if (!company && !website) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "company_name" or "website" is required' } });
    }
    if (website && typeof website === "string" && website.trim().length > 0 && !validateUrl(website)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"website" must be a valid URL if provided' } });
    }
    const result = await _meta(req, "contact-enrichment", () => contactEnrichment(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 9. Reputation Check
// ────────────────────────────────────────────────────────────────
router.post("/reputation-check", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept both "business_name" (spec) and "company_name" (legacy)
    const name = body.business_name || body.company_name;
    const profileUrl = body.profile_url;
    if (!name && !profileUrl) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "business_name" (or "company_name") or "profile_url" is required' } });
    }
    if (profileUrl && typeof profileUrl === "string" && profileUrl.trim().length > 0 && !validateUrl(profileUrl)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"profile_url" must be a valid URL if provided' } });
    }
    const result = await _meta(req, "reputation-check", () => reputationCheck(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 10. Proposal Generator
// ────────────────────────────────────────────────────────────────
router.post("/proposal-generator", async (req, res) => {
  try {
    const body = req.body || {};
    const service = body.service;
    const clientReqs = body.client_requirements;
    if (!service || typeof service !== "string" || service.trim().length < 3) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"service" is required (string, min 3 chars)' } });
    }
    if (!clientReqs || typeof clientReqs !== "string" || clientReqs.trim().length < 10) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"client_requirements" is required (string, min 10 chars)' } });
    }
    const result = await _meta(req, "proposal-generator", () => proposalGenerator(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 11. Business Blueprint
// ────────────────────────────────────────────────────────────────
router.post("/business-blueprint", async (req, res) => {
  try {
    const body = req.body || {};
    const idea = body.business_idea || body.businessType;
    if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"business_idea" is required (string, min 5 chars)' } });
    }
    if (body.pricing_tier && !["basic","intermediate","advanced","starter","beginner","easy","low","medium","moderate","hard","complex","expert","enterprise"].includes(body.pricing_tier)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"pricing_tier" must be one of: basic, intermediate, advanced, starter, beginner, easy, low, medium, moderate, hard, complex, expert, enterprise' } });
    }
    const result = await _meta(req, "business-blueprint", () => businessBlueprint(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 12. Document Intelligence
// ────────────────────────────────────────────────────────────────
router.post("/document-analysis", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept file (Buffer/Uint8Array/data URI) or document_text/text (string min 10 chars)
    const fileValid = body.file != null && (Buffer.isBuffer(body.file) || body.file instanceof Uint8Array || (typeof body.file === "string" && body.file.startsWith("data:")) || typeof body.file === "string" && body.file.trim().length >= 10);
    const textValid = (body.document_text || body.text) != null && typeof (body.document_text || body.text) === "string" && (body.document_text || body.text).trim().length >= 10;
    if (!fileValid && !textValid) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "file" (Buffer/Uint8Array/data URI/text string) or "document_text"/"text" (string, min 10 chars) is required' } });
    }
    const result = await _meta(req, "document-analysis", () => documentAnalysis(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 13. Invoice Extraction
// ────────────────────────────────────────────────────────────────
router.post("/invoice-extract", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept file (Buffer/Uint8Array/data URI) or invoice_text (string min 10 chars)
    const fileValid = body.file != null && (Buffer.isBuffer(body.file) || body.file instanceof Uint8Array || (typeof body.file === "string" && body.file.startsWith("data:")) || typeof body.file === "string" && body.file.trim().length >= 10);
    const textValid = body.invoice_text != null && typeof body.invoice_text === "string" && body.invoice_text.trim().length >= 10;
    if (!fileValid && !textValid) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "file" (Buffer/Uint8Array/data URI/text string) or "invoice_text" (string, min 10 chars) is required' } });
    }
    const result = await _meta(req, "invoice-extract", () => invoiceExtract(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 14. Contract Analysis
// ────────────────────────────────────────────────────────────────
router.post("/contract-review", async (req, res) => {
  try {
    const body = req.body || {};
    // Accept file (Buffer/Uint8Array/data URI) or contract_text (string min 10 chars)
    const fileValid = body.file != null && (Buffer.isBuffer(body.file) || body.file instanceof Uint8Array || (typeof body.file === "string" && body.file.startsWith("data:")) || typeof body.file === "string" && body.file.trim().length >= 10);
    const textValid = body.contract_text != null && typeof body.contract_text === "string" && body.contract_text.trim().length >= 10;
    if (!fileValid && !textValid) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "file" (Buffer/Uint8Array/data URI/text string) or "contract_text" (string, min 10 chars) is required' } });
    }
    const result = await _meta(req, "contract-review", () => contractReview(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 15. Deep Research
// ────────────────────────────────────────────────────────────────
router.post("/deep-research", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.question || typeof body.question !== "string" || body.question.trim().length < 5) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"question" is required (string, min 5 chars)' } });
    }
    const result = await _meta(req, "deep-research", () => deepResearch(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 16. Due Diligence
// ────────────────────────────────────────────────────────────────
router.post("/due-diligence", async (req, res) => {
  try {
    const body = req.body || {};
    const company = body.company || body.company_name;
    const url = body.company_url || body.website;
    if (!company && !url) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "company" (or "company_name") or "company_url" (or "website") is required' } });
    }
    if (url && typeof url === "string" && url.trim().length > 0 && !validateUrl(url)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"company_url" must be a valid URL if provided' } });
    }
    const result = await _meta(req, "due-diligence", () => dueDiligence(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 17. Social Analysis
// ────────────────────────────────────────────────────────────────
router.post("/social-analysis", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.profile_url || !validateUrl(body.profile_url)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"profile_url" is required and must be a valid URL' } });
    }
    const result = await _meta(req, "social-analysis", () => socialAnalysis(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 18. Candidate Analysis
// ────────────────────────────────────────────────────────────────
router.post("/candidate-analysis", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.job_description || typeof body.job_description !== "string" || body.job_description.trim().length < 10) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"job_description" is required (string, min 10 chars)' } });
    }
    if (!body.resume && !body.resume_text) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: 'Either "resume" (file) or "resume_text" (string) is required' } });
    }
    const result = await _meta(req, "candidate-analysis", () => candidateAnalysis(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 19. Business Email Sequence
// ────────────────────────────────────────────────────────────────
router.post("/business-email", async (req, res) => {
  try {
    const body = req.body || {};
    const purpose = body.email_purpose || body.purpose;
    if (!purpose || typeof purpose !== "string" || !["cold_outreach", "follow_up", "sales_sequence", "partnership", "customer_response", "inquiry", "proposal", "introduction", "newsletter", "appointment_reminder", "payment_reminder", "feedback_request", "upsell", "cross_sell", "reengagement", "referral_request", "event_invitation"].includes(purpose)) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"purpose" (or "email_purpose") is required: cold_outreach, follow_up, sales_sequence, partnership, customer_response, inquiry' } });
    }
    const result = await _meta(req, "business-email", () => businessEmail(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 20. AI Agent Task Executor
// ────────────────────────────────────────────────────────────────
router.post("/ai-agent", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.task || typeof body.task !== "string" || body.task.trim().length < 5) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"task" is required (string, min 5 chars)' } });
    }
    const result = await _meta(req, "ai-agent-execute", () => aiAgentExecute(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Agent execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 21. Lead Extraction
// ────────────────────────────────────────────────────────────────
router.post("/lead-extraction", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.source_url && !body.text && !body.content && !body.raw_text) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"source_url" or "text" is required' } });
    }
    const result = await _meta(req, "lead-extraction", () => leadExtraction(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

// ────────────────────────────────────────────────────────────────
// 21. OMIT Enrich
// ────────────────────────────────────────────────────────────────
router.post("/omitempty-enrich", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.text || typeof body.text !== "string" || body.text.trim().length < 1) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: '"text" is required (non-empty string)' } });
    }
    const result = await _meta(req, "omitempty-enrich", () => omittableEnrich(body, req));
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Workflow execution failed" } });
  }
});

export default router;
