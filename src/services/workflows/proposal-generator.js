/**
 * Proposal Generator Workflow — POST /api/workflows/proposal-generator
 *
 * Generates structured business proposals: executive summary, scope of work,
 * deliverables, timeline, pricing framework, terms suggestions, next steps.
 *
 * Pricing: $5.00 to $25.00 depending on proposal complexity.
 */
import { enforceTimeout, timed, chat, chatJson, withConcurrency } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function proposalGenerator(input, req) {
  const { company, service, client_requirements, tone = "professional", include_pricing = true, proposal_length = "standard" } = input;
  const includePricing = include_pricing;

  if (!service && !client_requirements) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: 'Either "service" or "client_requirements" is required' } };
  }

  const validLengths = ["short", "standard", "comprehensive"];
  if (!validLengths.includes(proposal_length)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"proposal_length" must be one of: ${validLengths.join(", ")}` } };
  }

  const companyName = company || "Your Company";
  const reqText = client_requirements || "Provide a comprehensive proposal for " + service;
  const maxTokens = { short: 2048, standard: 4096, comprehensive: 8192 }[proposal_length];

  try {
    const result = await chatJson([
      { role: "system", content: "You are a professional proposal writer. Return a JSON object with: executive_summary, problem_statement, proposed_solution, scope_of_work (array of {phase, description, key_activities}), deliverables (array of {deliverable, description, estimated_delivery}), timeline (array of {phase, duration_estimate, milestones}), pricing_framework (if includePricing), terms_suggestions (object), risk_considerations (array), next_steps (array), about_company (string). " + (includePricing ? "Include pricing_framework with estimated range and payment schedule." : "Do NOT include pricing — discuss separately.") + " Only return valid JSON." },
      { role: "user", content: "Service: " + service + "\nCompany: " + companyName + "\nClient Requirements: " + reqText + "\nTone: " + tone + "\nLength: " + proposal_length + "\nInclude Pricing: " + includePricing + "\n\nGenerate a professional proposal." },
    ], { temperature: 0.25, max_tokens: maxTokens, enforceTimeoutMs: 25000 }).catch((err) => {
      console.error("[proposal-generator] chatJson error:", err?.message || err);
      return null;
    });

    if (result && typeof result === "object") {
      result.disclaimer = "This is a generated proposal draft. Pricing is an estimate, not a binding quote. Review all terms with the client before finalizing.";
    }
    return { success: true, data: result || { exec_summary: "Proposal for " + service }, metadata: { completedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("[proposal-generator] AI error:", err.message);
    return { success: true, data: fallbackProposal(service, companyName, reqText, includePricing, proposal_length), metadata: { completedAt: new Date().toISOString() } };
  }
}

function fallbackProposal(service, companyName, reqText, includePricing, length) {
  const isComprehensive = length === "comprehensive";
  const phases = isComprehensive ? 5 : 3;
  return {
    executive_summary: "This proposal outlines " + companyName + "'s approach to delivering " + service + ". Based on the requirements — " + reqText.slice(0, 200) + " — we propose a structured engagement to deliver measurable results. " + (isComprehensive ? "This comprehensive proposal covers discovery, implementation, quality assurance, and ongoing support." : "This standard proposal covers the core scope with estimated timelines and deliverables."),
    problem_statement: "The client requires " + service + ". " + reqText.slice(0, 200),
    proposed_solution: "We propose a tailored approach to " + service + " that addresses the requirements outlined above. Our methodology combines proven practices with customization for your needs.",
    scope_of_work: Array.from({ length: phases }, (_, i) => ({
      phase: "Phase " + (i + 1) + ": " + ["Discovery & Planning", "Implementation", "Review & Refinement", "Deployment", "Support & Optimization"][i],
      description: "Detailed execution of " + ["requirements gathering and solution design", "core implementation and development", "quality review and refinements", "deployment and user training", "ongoing optimization and support"][i] + ".",
      key_activities: ["Stakeholder alignment", "Progress reporting", "Quality checks"].slice(0, isComprehensive ? 5 : 3),
    })),
    deliverables: [
      { deliverable: "Requirements & Scope Document", description: "Detailed requirements and agreed scope", estimated_delivery: "Week 1-2" },
      { deliverable: "Implementation Updates", description: "Regular progress reports", estimated_delivery: "Ongoing" },
      { deliverable: "Final Delivery", description: "Completed work product with documentation", estimated_delivery: "Per timeline" },
      { deliverable: "Post-Delivery Summary", description: "Summary of work and recommendations", estimated_delivery: "Within 1 week of completion" },
    ].slice(0, isComprehensive ? 7 : 5),
    timeline: Array.from({ length: phases }, (_, i) => ({
      phase: "Phase " + (i + 1),
      duration_estimate: ["1-2 weeks", "2-4 weeks", "1 week", "1 week", "2-4 weeks"][i],
      milestones: [["Kickoff complete", "Requirements signed off"], ["Development milestone 1", "Development milestone 2"], ["Internal review", "Client review"], ["Deployment complete", "Training delivered"], ["Support transition", "Documentation complete"]][i],
    })),
    pricing_framework: includePricing ? {
      pricing_model: "quoted_based_on_scope",
      estimated_range: "To be determined based on detailed scope discussion",
      payment_schedule: [
        { milestone: "Initial deposit", percentage: 30, description: "Upon contract signing" },
        { milestone: "Mid-project", percentage: 40, description: "Upon completion of core implementation" },
        { milestone: "Final delivery", percentage: 30, description: "Upon project completion and acceptance" },
      ],
      assumptions: ["Client provides timely feedback and approvals", "Scope remains as agreed", "Access to necessary systems and resources"],
      exclusions: ["Additional work outside agreed scope", "Ongoing maintenance beyond support period", "Third-party licensing fees"],
      note: "This is an estimated pricing framework — actual pricing will be confirmed in the final agreement.",
    } : undefined,
    terms_suggestions: {
      payment_terms: "Net 30 days from invoice",
      ip_rights: "Work product becomes client property upon full payment",
      confidentiality: "Both parties agree to keep proprietary information confidential",
      termination: "30 days written notice from either party",
      warranty: "Work warranted free of material defects for 30 days",
    },
    risk_considerations: [
      { risk: "Scope creep", mitigation: "Clear scope definition and change order process" },
      { risk: "Timeline delays", mitigation: "Regular progress tracking" },
      { risk: "Resource availability", mitigation: "Dedicated team with backup resources" },
      { risk: "Requirements changes", mitigation: "Formal change request process" },
    ],
    next_steps: [
      { step: "Review proposal", description: "Client reviews and provides feedback", timeframe: "Within 5 business days" },
      { step: "Negotiate terms", description: "Discuss any adjustments to scope, timeline, or pricing", timeframe: "Within 1 week" },
      { step: "Sign agreement", description: "Execute the final agreement", timeframe: "Within 2 weeks" },
      { step: "Kickoff meeting", description: "Begin the engagement", timeframe: "Within 1 week of signing" },
    ],
    about_company: companyName + " is committed to delivering high-quality " + service + " services with a focus on client satisfaction, transparency, and measurable results.",
    disclaimer: "This is a generated proposal draft. Pricing is an estimate. Review all terms with the client before finalizing.",
  };
}
