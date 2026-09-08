/**
 * Job Candidate Analysis Workflow — POST /api/workflows/candidate-analysis
 *
 * Analyzes a resume (file upload or text) against a job description (text).
 * Returns: skills match, experience match, strengths, missing qualifications,
 * suggested interview questions.
 *
 * IMPORTANT: This is an assistive analysis tool only — NOT for making
 * employment decisions. Output should not be the sole basis for hiring.
 */
import { extractTextFromFile } from "../../lib/workflow-utils.js";
import { enforceTimeout } from "../../lib/timing.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function candidateAnalysis(input, req) {
  const resumeFile = input.resume;
  const resumeText = input.resume_text || "";
  const jobDescription = input.job_description;

  if (!jobDescription || typeof jobDescription !== "string" || jobDescription.trim().length < 10) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"job_description" is required (at least 10 characters)' } };
  }

  let resumeRaw;
  if (resumeText && resumeText.trim().length > 10) {
    resumeRaw = resumeText.trim();
  } else if (resumeFile) {
    let buffer;
    if (typeof resumeFile === "string" && resumeFile.startsWith("data:")) {
      const comma = resumeFile.indexOf(",");
      if (comma < 0) return { success: false, error: { code: "VALIDATION_ERROR", message: "resume data URI malformed" } };
      const b64 = resumeFile.slice(comma + 1);
      try { buffer = Buffer.from(b64, "base64"); } catch { return { success: false, error: { code: "VALIDATION_ERROR", message: "base64 decode failed" } }; }
      if (buffer.length > 10_000_000) return { success: false, error: { code: "VALIDATION_ERROR", message: "Resume file too large — max 10MB" } };
    } else if (Buffer.isBuffer(resumeFile) || resumeFile instanceof Uint8Array) {
      buffer = Buffer.from(resumeFile);
      if (buffer.length > 10_000_000) return { success: false, error: { code: "VALIDATION_ERROR", message: "Resume file too large — max 10MB" } };
    } else {
      return { success: false, error: { code: "VALIDATION_ERROR", message: '"resume" must be Buffer, Uint8Array, or data URI' } };
    }
    try {
      resumeRaw = await enforceTimeout(20_000, async () => extractTextFromFile(buffer, input.filename || "resume"));
    } catch (err) {
      console.error("[candidate-analysis] extraction error:", err.message);
      resumeRaw = buffer.toString("utf8").slice(0, 15000);
    }
    if (!resumeRaw || resumeRaw.trim().length < 10) {
      return { success: false, error: { code: "NO_TEXT", message: "Could not extract readable text from resume" } };
    }
  } else {
    return { success: false, error: { code: "VALIDATION_ERROR", message: 'Either "resume" (file) or "resume_text" (string) is required' } };
  }

  const jd = jobDescription.trim();
  const resumePreview = resumeRaw.slice(0, 10000);

  try {
    const analysis = await chatJson([
      { role: "system", content: "You are a candidate analysis assistant. Compare the resume against the job description. Return a JSON object with: skills_match ({matched_skills (array from JD found in resume), missing_skills (array NOT in resume), partial_skills (array unclear), match_percentage (0-100)}), experience_assessment ({years_estimate (string), relevant_experience (array), gaps (array)}), strengths ({summary, strengths_list (array), evidence (array of {strength, evidence_from_resume})}), missing_or_unclear ({items (array), concerns (array — be constructive)}), interview_recommendations ({questions (array of 5-8 questions), areas_to_probe (array)}), overall_assessment ({summary, fit_indication (strong_match/good_fit/partial_fit/limited_fit/insufficient_information), recommendation_note}). IMPORTANT: This is assistive analysis only. Do NOT make employment decisions. Do not discriminate. If info is missing, note as unknown. Resume may be incomplete." },
      { role: "user", content: "JOB DESCRIPTION:\n\n" + jd + "\n\nRESUME:\n\n" + resumePreview + "\n\nAnalyze and report." },
    ], { temperature: 0.2, max_tokens: 3072 });

    if (analysis) {
      analysis.assistive_notice = "This is an assistive analysis tool only. It should NOT be the sole basis for hiring decisions. Human review of the resume, interview, and other factors is essential. Do not use this analysis to discriminate.";
    }
    return { success: true, data: analysis, metadata: { completedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("[candidate-analysis] AI error:", err.message);
    return { success: true, data: fallbackCandidateAnalysis(resumePreview, jd), metadata: { completedAt: new Date().toISOString() } };
  }
}

function fallbackCandidateAnalysis(resume, jd) {
  const jdLower = jd.toLowerCase();
  const resumeLower = resume.toLowerCase();
  const jdSkills = extractSkillsFromJd(jd);
  const matched = jdSkills.filter((s) => resumeLower.includes(s.toLowerCase())).slice(0, 20);
  const missing = jdSkills.filter((s) => !resumeLower.includes(s.toLowerCase())).slice(0, 15);

  return {
    skills_match: {
      matched_skills: matched,
      missing_skills: missing,
      partial_skills: [],
      match_percentage: matched.length > 0 ? Math.round((matched.length / Math.max(jdSkills.length, 1)) * 100) : 0,
    },
    experience_assessment: {
      years_estimate: resume.split(/\s+/).filter(Boolean).length > 500 ? "Likely several years — resume length suggests experience" : resume.split(/\s+/).filter(Boolean).length > 200 ? "Likely 1-3 years" : "Unable to estimate from text",
      relevant_experience: resume.split(/\n+/).filter((l) => l.trim().length > 20).slice(0, 5).map((l) => l.trim().slice(0, 200)),
      gaps: missing.slice(0, 5).map((s) => "Could not confirm: " + s),
    },
    strengths: {
      summary: "Resume demonstrates relevant background for the position based on keyword matching.",
      strengths_list: matched.slice(0, 5).length > 0 ? matched.slice(0, 5) : ["Submitted resume for review"],
      evidence: matched.slice(0, 5).map((s) => ({ strength: s, evidence: "Keyword found in resume" })),
    },
    missing_or_unclear: {
      items: missing.slice(0, 10),
      concerns: missing.length > 5 ? ["Several skills from the job description were not clearly found in the resume — may be under different terms or not highlighted"] : [],
    },
    interview_recommendations: {
      questions: [
        "Can you walk me through your relevant experience for this role?",
        "What experience do you have with skills or areas where your resume was less clear?",
        "Describe a project or achievement you're most proud of that's relevant to this position.",
        "How do your skills align with the key requirements we've discussed?",
        "What areas are you looking to develop further?",
        "Can you provide examples of your work that demonstrate [key_skill]?",
        "What questions do you have about the role and our team?",
        "Is there anything in your background that particularly prepared you for this position?",
      ].slice(0, 8),
      areas_to_probe: missing.slice(0, 5).map((s) => "Confirm experience with: " + s),
    },
    overall_assessment: {
      summary: "Preliminary analysis based on keyword matching between resume and job description. " + matched.length + " of " + jdSkills.length + " identified skills matched. This is one input among many for hiring decisions.",
      fit_indication: matched.length > jdSkills.length * 0.6 ? "good_fit" : matched.length > jdSkills.length * 0.3 ? "partial_fit" : "limited_fit",
      recommendation_note: "Review the candidate's resume in detail, conduct an interview, and consider all relevant factors. This automated analysis is assistive only.",
    },
    assistive_notice: "This is an assistive analysis tool only. Do NOT make employment decisions based solely on this output. Human review is essential.",
  };
}

function extractSkillsFromJd(jd) {
  const skillPatterns = [
    /\bpython\b|\bjava\b|\bjavascript\b|\btypescript\b|\bgo\b|\brust\b|\bc\+\+\b|\bc#\b|\bruby\b|\bphp\b|\bswift\b|\bkotlin\b/g,
    /\breact\b|\bangular\b|\bvue\b|\bnode\.?js\b|\bnginx\b|\bkubernetes\b|\bdocker\b|\baws\b|\bazure\b|\bgcp\b/g,
    /\bsql\b|\bpostgresql\b|\bmysql\b|\bmongodb\b|\bredis\b|\belasticsearch\b/g,
    /\bmachine learning\b|\bdeep learning\b|\bnlp\b|\bcomputer vision\b|\btensorflow\b|\bpytorch\b/g,
    /\bproject management\b|\bagile\b|\bscrum\b|\bleadership\b|\bcommunication\b|\bteamwork\b/g,
    /\bsales\b|\bmarketing\b|\bcustomer service\b|\baccount management\b|\bbusiness development\b/g,
    /\baccounting\b|\bfinance\b|\bbookkeeping\b|\bcpa\b|\btax\b/g,
    /\bdesign\b|\bphotoshop\b|\bfigma\b|\bsketch\b|\bui\b|\bux\b|\bgraphic\b/g,
  ];
  const skills = new Set();
  for (const pattern of skillPatterns) {
    let m;
    while ((m = pattern.exec(jd)) !== null) {
      skills.add(m[0]);
    }
  }
  const phraseRe = /[A-Z][a-z]+(?:[\s][A-Z][a-z]+){1,3}/g;
  while ((m = phraseRe.exec(jd)) !== null) {
    const phrase = m[0];
    if (phrase.length > 5 && phrase.length < 40 && !/^(The|This|With|From|For|And|Or|But|In|On|At|To|Of|By|As|Is|Are|Was|Were|Be|Have|Has|Had|Will|Would|Could|Should|May|Can|Cannot|These|Those|What|When|Where|Why|How|Who|Whom|Which|Whose|There|Here|Then|Now|Today|Yesterday|Tomorrow|Please|Thank|Hi|Hello|Dear|Sincerely|Regards|Best)/i.test(phrase)) {
      skills.add(phrase);
    }
  }
  return Array.from(skills).slice(0, 30);
}
