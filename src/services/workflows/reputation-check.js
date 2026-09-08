/**
 * Reputation Check Workflow — POST /api/workflows/reputation-check
 *
 * Analyzes publicly available reputation signals for a company or profile.
 * Returns reputation summary, sentiment, strengths, issues, recommendations.
 */
import { webSearch } from "../../lib/workflow-utils.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function reputationCheck(input, req) {
  const { business_name, profile_url, location, platform } = input;
  if (!business_name && !profile_url) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: 'Either "business_name" or "profile_url" is required' } };
  }

  const searchSubject = business_name || (profile_url ? extractDomain(profile_url) : "");
  const searchQueries = [
    searchSubject + " reviews",
    searchSubject + " reputation",
    searchSubject + " complaints",
    searchSubject + " ratings",
  ];
  const effectivePlatform = platform || (profile_url ? guessPlatform(profile_url) : "");

  const allSignals = [];
  for (const q of searchQueries) {
    let results;
    try { results = await webSearch(q, { maxResults: 8 }); } catch { results = []; }
    for (const r of results) {
      allSignals.push({
        source: q,
        title: r.title,
        snippet: r.snippet || "",
        url: r.url,
        sentiment: inferSentiment(r.title + " " + (r.snippet || "")),
      });
    }
  }

  if (allSignals.length === 0) {
    return {
      success: true,
      data: {
        subject: searchSubject,
        reputation_summary: "No publicly available reputation signals found for " + searchSubject + ".",
        sentiment: "unknown",
        strengths: [],
        issues: [],
        recommendations: ["Consider establishing a web presence and collecting customer reviews."],
        data_sources: [],
        data_quality: { note: "No public signals found — reflects current web presence, not quality." },
      },
      metadata: { completedAt: new Date().toISOString() },
    };
  }

  const positive = allSignals.filter((s) => s.sentiment === "positive").length;
  const negative = allSignals.filter((s) => s.sentiment === "negative").length;
  const neutral = allSignals.filter((s) => s.sentiment === "neutral").length;
  let sentiment = "neutral";
  if (positive > negative && positive >= 3) sentiment = "positive";
  else if (negative > positive && negative >= 3) sentiment = "negative";
  else if (positive > 0 && negative > 0) sentiment = "mixed";

  let synthesis;
  try {
    const signalsText = allSignals.slice(0, 15).map((s, i) =>
      (i + 1) + ". [" + s.sentiment + "] " + s.title + " — " + (s.snippet || "").slice(0, 200) + " (Source: " + s.source + ")"
    ).join("\n");

    synthesis = await chatJson([
      { role: "system", content: "You are a reputation analyst. Return a JSON object with: reputation_summary (2-3 sentences), sentiment (positive/negative/mixed/neutral), strengths (array of {strength, evidence}), issues (array of {issue, evidence, severity low/medium/high}), recommendations (array of {recommendation, rationale}). Be honest about what the data shows." },
      { role: "user", content: "Subject: " + searchSubject + "\n\nSignals (" + positive + " positive, " + negative + " negative, " + neutral + " neutral):\n\n" + signalsText + "\n\nGenerate a reputation report." },
    ], { temperature: 0.3, max_tokens: 2048 });
  } catch (err) {
    console.error("[reputation-check] AI error:", err.message);
    synthesis = {};
  }

  const strengths = (synthesis?.strengths || []).length ? synthesis.strengths : (positive > 0 ? [{ strength: "Positive signals detected", evidence: positive + " positive search results" }] : []);
  const issues = (synthesis?.issues || []).length ? synthesis.issues : (negative > 0 ? [{ issue: "Negative signals detected", evidence: negative + " negative search results", severity: negative > 5 ? "medium" : "low" }] : []);

  return {
    success: true,
    data: {
      subject: searchSubject,
      platform: effectivePlatform,
      profile_url: profile_url || null,
      reputation_summary: synthesis?.reputation_summary || "Based on " + allSignals.length + " public search results: " + positive + " positive, " + negative + " negative, " + neutral + " neutral.",
      sentiment,
      sentiment_breakdown: { positive, negative, neutral, total: allSignals.length },
      strengths: strengths.slice(0, 10),
      issues: issues.slice(0, 10),
      recommendations: (synthesis?.recommendations || ["Monitor reputation regularly", "Respond to customer feedback professionally", "Address recurring complaints proactively"]).slice(0, 8),
      data_sources: allSignals.slice(0, 20).map((s) => ({ source: s.source, url: s.url, title: s.title, sentiment: s.sentiment })),
      data_quality: {
        signals_analyzed: allSignals.length,
        sources_searched: searchQueries.length,
        verified: false,
        note: "All data from public web search results — not independently verified.",
      },
    },
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function guessPlatform(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
  if (u.includes("facebook.com")) return "facebook";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("yelp.com")) return "yelp";
  if (u.includes("google.com") && u.includes("review")) return "google";
  if (u.includes("glassdoor.com")) return "glassdoor";
  if (u.includes("trustpilot.com")) return "trustpilot";
  if (u.includes("reddit.com")) return "reddit";
  return "web";
}

function inferSentiment(text) {
  const l = text.toLowerCase();
  const pos = /(great|excellent|good|recommended|love|happy|satisfied|trust|phenomenal|wonderful|fantastic|better|best|top|innovative|reliable|professional|friendly|quality service|positive)/i.test(l);
  const neg = /(bad|terrible|awful|horrible|scam|fake|fraud|rip.?off|consumer complaint|never again|do not|avoid|waste|poor|disappointed|hate|worst|sucks|complaint|negative|unhappy|angry|refund|cheat|deceptive)/i.test(l);
  if (pos && !neg) return "positive";
  if (neg && !pos) return "negative";
  return "neutral";
}
