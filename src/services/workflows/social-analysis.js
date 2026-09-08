/**
 * Social Media Analysis Workflow — POST /api/workflows/social-analysis
 *
 * Analyzes publicly accessible social media profile data. Only analyzes
 * public data and content.
 *
 * Returns: profile overview, content patterns, topic analysis, engagement
 * indicators where available, competitor opportunities, content recommendations.
 */
import { webSearch, scrape } from "../../lib/workflow-utils.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function socialAnalysis(input, req) {
  const { profile_url, platform } = input;

  if (!profile_url) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"profile_url" is required' } };
  }

  const validPlatforms = ["instagram", "twitter", "facebook", "linkedin", "tiktok", "youtube", "generic"];
  const effectivePlatform = platform && validPlatforms.includes(platform) ? platform : "generic";

  let profileData = null;
  let scrapeError = null;

  try { profileData = await scrape(profile_url); } catch (err) {
    scrapeError = err.message;
    console.error("[social-analysis] scrape error:", err.message);
  }

  let searchResults = [];
  try {
    const domain = extractDomain(profile_url);
    searchResults = await webSearch(domain + " social media profile", { maxResults: 6 });
  } catch {}

  const profileContent = {
    profile_url,
    platform: effectivePlatform,
    scraped: !!profileData,
    scrape_error: scrapeError || null,
    title: profileData?.title || "",
    description: profileData?.description || "",
    image: profileData?.image || "",
    favicon: profileData?.favicon || "",
    follower_count_raw: extractMetric(profileData?.description || "", /(?:followers?|subs?|likes?|members?)\s*[:\.]?\s*([\d,]+)/i),
    content_description: profileData?.content_summary || "",
    technologies: profileData?.technologies || [],
  };

  if (searchResults.length > 0) {
    profileContent.search_snippets = searchResults.slice(0, 6).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet?.slice(0, 200) }));
    profileContent.search_based_info = true;
  }

  let analysis;
  try {
    analysis = await chatJson([
      { role: "system", content: "You are a social media analyst. Return a JSON object with: profile_overview (2-3 sentences), content_patterns (array of {pattern, evidence}), topic_analysis (array of {topic, observation}), engagement_indicators ({followers_estimate, engagement_observable, notes} — only what can be inferred, clearly labeled as estimates), strengths (array), content_recommendations (array), data_quality ({scraped, search_based, notes}), limitations (array). Be honest about what can and cannot be determined. Do not fabricate engagement metrics." },
      { role: "user", content: "Profile URL: " + profile_url + "\nPlatform: " + effectivePlatform + "\n\nProfile data:\n" + JSON.stringify(profileContent, null, 2) + "\n\nAnalyze and return JSON." },
    ], { temperature: 0.2, max_tokens: 2048 });
  } catch (err) {
    console.error("[social-analysis] AI error:", err.message);
    analysis = fallbackSocialAnalysis(profileContent);
  }

  return {
    success: true,
    data: Object.assign({}, analysis || {}, {
      profile_url,
      platform: effectivePlatform,
      analysis_generated_at: new Date().toISOString(),
      raw_profile_data: {
        scraped: profileContent.scraped,
        title: profileContent.title,
        description: profileContent.description,
        image: profileContent.image,
        favicon: profileContent.favicon,
        follower_count_raw: profileContent.follower_count_raw,
      },
      data_disclaimer: "Analysis based only on publicly accessible data. Actual follower counts, engagement rates, and private metrics are not accessible through public data scraping. Estimates are AI-generated based on available signals and should not be treated as accurate measurements.",
    }),
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function extractMetric(text, regex) {
  const m = text.match(regex);
  if (m) {
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

function fallbackSocialAnalysis(profile) {
  return {
    profile_overview: "Profile at " + profile.profile_url + " was " + (profile.scraped ? "successfully scraped" : "not accessible for scraping") + ". " + (profile.search_based_info ? "Additional information gathered from web search results." : "Limited information available from public sources."),
    content_patterns: profile.scraped && profile.content_description ? [{ pattern: "Content described as: " + profile.content_description.slice(0, 150), evidence: "Direct from page content" }] : [],
    topic_analysis: profile.scraped && profile.content_description ? [{ topic: profile.content_description.slice(0, 80), frequency_estimate: "unknown from public data", observation: "Content analysis limited by available data" }] : [],
    engagement_indicators: {
      followers_estimate: profile.follower_count_raw || null,
      engagement_observable: false,
      notes: "Precise engagement metrics, follower counts, and interaction rates are not publicly accessible from profile pages. Any numbers shown are from visible text on the page and may be outdated or inaccurate.",
    },
    strengths: profile.scraped && profile.title ? [{ strength: "Active profile with identifiable content", evidence: "Page content available" }] : [],
    content_recommendations: [
      { recommendation: "Review competitor profiles with similar audience", rationale: "Understanding competitor content strategy can inform your own approach" },
      { recommendation: "Analyze content topics and posting frequency", rationale: "Content gaps and opportunities become visible through comparative analysis" },
    ],
    data_quality: {
      scraped: profile.scraped,
      search_based: profile.search_based_info || false,
      notes: profile.scrape_error ? "Scrape failed: " + profile.scrape_error : "Data from " + (profile.scraped ? "direct page scrape" : "web search only"),
    },
    limitations: [
      { limitation: "Follower counts and engagement rates not accessible", explanation: "These metrics require platform API access or authenticated sessions" },
      { limitation: "Content calendar and posting schedule not observable", explanation: "History and timing patterns require platform data access" },
      { limitation: "Audience demographics not available", explanation: "Demographics require platform analytics access" },
    ],
  };
}
