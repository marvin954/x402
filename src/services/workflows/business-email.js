/**
 * Business Email Sequence Workflow — POST /api/workflows/business-email
 *
 * Generates business email content: cold outreach, follow-ups, sales sequences,
 * partnership outreach, customer responses.
 *
 * Pricing tiers: basic ($1.00), professional ($3.00), premium ($10.00).
 */
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

const EMAIL_PRESETS = {
  cold_outreach: {
    subject: "Quick question about your operations at {{company}}",
    body: "Hi {{recipient}},\n\nI came across {{company}} and was impressed by {{specific_observation}}. I help companies like yours {{value_proposition}}.\n\nWould you be open to a brief conversation about how we might support your goals?\n\nBest,\n{{sender}}\n{{sender_company}}",
    tone: "friendly, professional, low-pressure",
    placeholders: ["recipient", "company", "specific_observation", "value_proposition", "sender", "sender_company"],
  },
  follow_up: {
    subject: "Following up — {{context}}",
    body: "Hi {{recipient}},\n\nJust circling back on my previous note about {{topic}}. I know things get busy, so I wanted to check in.\n\nIs this something you'd be interested in exploring? Happy to answer any questions or jump on a quick call.\n\nBest,\n{{sender}}",
    tone: "brief, respectful, clear",
    placeholders: ["recipient", "context", "topic", "sender"],
  },
  sales_sequence_step1: {
    subject: "Helping {{company}} achieve {{goal}}",
    body: "Hi {{recipient}},\n\nI'm reaching out because we've helped companies like {{company}} achieve {{result}}. I'd love to learn more about your current priorities and see if there's a fit.\n\nWould you be open to a 15-minute conversation?\n\nBest,\n{{sender}}\n{{sender_company}}",
    tone: "professional, value-focused, low-pressure",
    placeholders: ["recipient", "company", "goal", "result", "sender", "sender_company"],
  },
  sales_sequence_step2: {
    subject: "Thoughts on {{pain_point}}",
    body: "Hi {{recipient}},\n\nI wanted to share a thought about {{pain_point}}. Many companies in your space face this challenge, and we've found that {{solution_approach}} can make a meaningful difference.\n\nIs this relevant to what you're working on?\n\nBest,\n{{sender}}",
    tone: "insightful, helpful, consultative",
    placeholders: ["recipient", "pain_point", "solution_approach", "sender"],
  },
  partnership: {
    subject: "Partnership opportunity: {{sender_company}} + {{company}}",
    body: "Hi {{recipient}},\n\nI'm {{sender}} from {{sender_company}}. We've been following what {{company}} is doing in {{area}} and see potential for a mutually beneficial partnership.\n\nSpecifically, we believe {{synergy_description}}.\n\nWould you be open to exploring this further?\n\nBest,\n{{sender}}",
    tone: "professional, collaborative, mutually beneficial",
    placeholders: ["recipient", "sender", "sender_company", "company", "area", "synergy_description"],
  },
  customer_response: {
    subject: "Thank you — {{context}}",
    body: "Hi {{recipient}},\n\nThank you for reaching out about {{topic}}. We appreciate the opportunity to help {{company}} with {{need}}.\n\n{{response_content}}\n\nPlease let me know if you have any additional questions.\n\nBest,\n{{sender}}",
    tone: "helpful, professional, customer-focused",
    placeholders: ["recipient", "context", "topic", "company", "need", "response_content", "sender"],
  },
  networking: {
    subject: "Connecting re: {{topic}}",
    body: "Hi {{recipient}},\n\nI came across your work on {{topic}} and wanted to connect. I'm also focused on {{related_area}} and would love to stay in touch.\n\n{{personal_note}}\n\nBest,\n{{sender}}",
    tone: "genuine, professional, relationship-building",
    placeholders: ["recipient", "topic", "related_area", "personal_note", "sender"],
  },
  thank_you: {
    subject: "Thank you, {{recipient}}",
    body: "Hi {{recipient}},\n\nThank you for {{reason}}.\n\nI really appreciate {{specific_thing}}.\n\nLooking forward to {{next_step}}.\n\nBest,\n{{sender}}",
    tone: "warm, sincere, professional",
    placeholders: ["recipient", "reason", "specific_thing", "next_step", "sender"],
  },
  breakup_email: {
    subject: "Should I close your file?",
    body: "Hi {{recipient}},\n\nI haven't heard back, so I assume {{topic}} isn't a priority right now — completely understand.\n\nI'll close your file for now, but feel free to reach out anytime if things change.\n\nBest,\n{{sender}}",
    tone: "graceful, no-pressure, respectful",
    placeholders: ["recipient", "topic", "sender"],
  },
};

export async function businessEmail(input, req) {
  // Accept both legacy and spec field names
  const purpose = input.email_purpose || input.purpose;
  const recipient_name = input.recipient_name || input.recipient;
  const recipient_company = input.company_name || input.company || input.recipient_company;
  const sender_name = input.sender_name;
  const sender_company = input.sender_company;
  const tone_override = input.tone_override || input.tone;
  const pkg = input.package || input.email_package || "medium";
  const context = input.key_points ? { specific_observation: input.key_points.join("; ") } : input.context || {};

  if (!purpose || typeof purpose !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"email_purpose" is required (e.g. "cold_outreach", "follow_up", "sales_sequence", "partnership", "customer_response", "networking", "thank_you", "breakup_email")' } };
  }

  const validPurposes = Object.keys(EMAIL_PRESETS);
  if (!validPurposes.includes(purpose)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"email_purpose" must be one of: ${validPurposes.join(", ")}` } };
  }

  const validPackages = ["small", "medium", "large"];
  if (!validPackages.includes(pkg)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"email_package" must be one of: ${validPackages.join(", ")}` } };
  }

  const followUpCount = input.follow_up_count || pkg === "small" ? 0 : pkg === "medium" ? 2 : 4;
  const includeSubjectLine = input.include_subject_line ?? input.include_subject ?? true;
  const preset = EMAIL_PRESETS[purpose];

  const values = {
    recipient: recipient_name || "[Recipient Name]",
    company: recipient_company || "[Company Name]",
    sender: sender_name || "[Your Name]",
    sender_company: sender_company || "[Your Company]",
    specific_observation: context?.specific_observation || "[specific observation about their business]",
    value_proposition: context?.value_proposition || "[what you help companies achieve]",
    topic: context?.topic || "[topic of previous conversation]",
    context: context?.context || "[context of previous contact]",
    goal: context?.goal || "[goal relevant to their business]",
    result: context?.result || "[result you've helped similar companies achieve]",
    pain_point: context?.pain_point || "[relevant pain point]",
    solution_approach: context?.solution_approach || "[your approach to solving this]",
    area: context?.area || "[area where you see synergy]",
    synergy_description: context?.synergy_description || "[description of mutual benefit]",
    need: context?.need || "[their need]",
    response_content: context?.response_content || "[your response to their inquiry]",
    related_area: context?.related_area || "[your related area of focus]",
    personal_note: context?.personal_note || "[a genuine personal note]",
    reason: context?.reason || "[reason for thanks]",
    specific_thing: context?.specific_thing || "[specific thing you appreciate]",
    next_step: context?.next_step || "[next step or future interaction]",
  };

  const fillTemplate = (template) => {
    let result = template;
    for (const [key, val] of Object.entries(values)) {
      result = result.replace(new RegExp("{{" + key + "}}", "g"), val);
    }
    return result;
  };

  const filledSubject = fillTemplate(preset.subject);
  const filledBody = fillTemplate(preset.body);

  let variations = null;
  if (emailsToGenerate > 1) {
    try {
      variations = await chatJson([
        { role: "system", content: "You are an email copywriting expert. Generate " + emailsToGenerate + " variations of the following email. Each variation should be distinct in wording but preserve the same intent, tone (" + (tone_override || preset.tone) + "), and call to action. Return a JSON array of {subject, body, key_points (array of 2-3 bullet points)}. Use the placeholders filled in below. Return ONLY a JSON array." },
        { role: "user", content: "Original email:\nSubject: " + filledSubject + "\n\nBody:\n" + filledBody + "\n\nGenerate " + emailsToGenerate + " variations." },
      ], { temperature: 0.4, max_tokens: 4096 });
    } catch (err) {
      console.error("[business-email] AI variation error:", err.message);
      variations = [];
    }
  }

  const subjectLines = variations && Array.isArray(variations) && variations.length > 0
    ? variations.map((v) => v.subject)
    : [filledSubject];

  const bodies = variations && Array.isArray(variations) && variations.length > 0
    ? variations.map((v) => v.body)
    : [filledBody];

  const emails = Array.from({ length: Math.min(emailsToGenerate, subjectLines.length) }, (_, i) => ({
    subject: subjectLines[i % subjectLines.length],
    body: bodies[i % bodies.length],
    tone: tone_override || preset.tone,
    purpose,
    position: i + 1,
    placeholders_used: Object.keys(values).filter((k) => !values[k].startsWith("[")),
    placeholders_remaining: Object.keys(values).filter((k) => values[k].startsWith("[")),
    ready_to_send: Object.keys(values).filter((k) => values[k].startsWith("[")).length === 0,
    tip: Object.keys(values).filter((k) => values[k].startsWith("[")).length > 0
      ? "Review and fill in " + Object.keys(values).filter((k) => values[k].startsWith("[")).join(", ") + " before sending"
      : "Ready to send — review for accuracy",
  }));

  return {
    success: true,
    data: {
      purpose,
      package: pkg,
      emails_generated: emails.length,
      emails: emails,
      sequencing_advice: pkg === "large" ? "For a full sequence: space emails 3-5 business days apart. Start with value-focused outreach, follow with relevant insights, end gracefully if no response." : pkg === "medium" ? "Space follow-ups 3-5 business days apart. Don't send more than 3-4 emails without a response." : "Send one email. If no response in 5-7 days, consider a single polite follow-up.",
      best_practices: [
        "Personalize the opening for each recipient",
        "Keep the subject line clear and relevant",
        "Have a single, clear call to action",
        "Proofread before sending — check all placeholders are filled",
        "Follow up once or twice, then move on if no response",
        "Track opens and responses to refine your approach",
      ],
      tone_used: tone_override || preset.tone,
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}
