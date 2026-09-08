
/**
 * Website Audit Workflow — POST /api/workflows/website-audit
 *
 * Analyzes a website URL for SEO, performance signals, technology stack,
 * content quality, UX heuristics, and conversion opportunities.
 */
import { scrape } from "../../lib/workflow-utils.js";
import { chat, chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";
import { error } from "../../lib/errors.js";

export async function websiteAudit(input, req) {
  const { url, sections = ["seo", "performance", "technology", "content", "ux", "conversion"] } = input;
  if (!url || typeof url !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"url" is required' } };
  }
  try { new URL(url); } catch { return { success: false, error: { code: "VALIDATION_ERROR", message: '"url" must be a valid http/https URL' } }; }

  const validSections = ["seo", "performance", "technology", "content", "ux", "conversion", "recommendations"];
  const requested = sections.filter(s => validSections.includes(s));
  if (requested.length === 0) return { success: false, error: { code: "VALIDATION_ERROR", message: 'sections must include at least one of: ' + validSections.join(", ") } };

  // 1. Scrape the website
  let page;
  try {
    page = await scrape(url);
  } catch (err) {
    return { success: false, error: { code: "SCRAPE_ERROR", message: `Failed to fetch ${url}: ${err.message}` } };
  }

  const html = page.text || "";
  const wordCount = html.split(/\s+/).filter(Boolean).length;

  // 2. Basic SEO analysis
  const seo = {
    hasTitleTag: /<title[^>]*>[^<]+<\/title>/i.test(html),
    titleLength: (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.length || 0),
    hasMetaDescription: /<meta[^>]+name=["']description["']/i.test(html),
    metaDescriptionLength: (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.length || 0),
    hasH1: /<h1[^>]*>/i.test(html),
    h1Count: (html.match(/<h1[^>]*>/gi) || []).length,
    hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    hasOGTags: /<meta[^>]+property=["']og:/i.test(html),
    hasTwitterCards: /<meta[^>]+name=["']twitter:/i.test(html),
    hasStructuredData: /<script[^>]+type=["']application\/ld\+json["']/i.test(html),
    wordCount,
    keywordDensity: {},
  };

  // 3. Performance heuristics (from HTML, not real lighthouse — be honest)
  const performance = {
    hasLazyLoading: /loading=["']lazy["']/i.test(html),
    hasMinifiedCSS: /\.css\?v=|\.min\.css/i.test(html),
    hasMinifiedJS: /\.js\?v=|\.min\.js/i.test(html),
    hasLargeImages: (html.match(/<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg|webp))["']/gi) || []).length,
    imageCount: (html.match(/<img[^>]+/gi) || []).length,
    scriptCount: (html.match(/<script[^>]+/gi) || []).length,
    externalScripts: (html.match(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/gi) || []).length,
    hasCDN: /\/cdn\.|cloudflare|jsdelivr|unpkg|cdnjs/i.test(html),
    hasHTTP2Hints: /preload|preconnect|dns-prefetch/i.test(html),
  };

  // 4. Technology detection
  const technologies = detectTechnologies(html);

  // 5. Content analysis
  const content = {
    wordCount,
    hasText: wordCount > 100,
    hasHeadings: (html.match(/<h[1-6][^>]*>/gi) || []).length,
    headingStructure: extractHeadings(html),
    readingTimeMinutes: Math.max(1, Math.round(wordCount / 200)),
    hasAltTexts: (html.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length,
    imageWithAltRatio: performance.imageCount > 0 ? ((html.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length / performance.imageCount * 100).toFixed(0) + "%" : "N/A",
    hasInternalLinks: (html.match(/<a[^>]+href=["'](?!https?:\/\/|mailto:|tel:|#)[^"']+["']/gi) || []).length,
  };

  // 6. UX heuristics
  const ux = {
    hasMobileMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasFavicon: /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html),
    hasContactInfo: /contact|email|phone|tel:|mailto:/i.test(html),
    hasCallToAction: /sign up|get started|contact us|book now|order|buy now|submit|click here|button/i.test(html),
    hasSearch: /search|searchform|searchbox/i.test(html),
    hasNavigation: /<nav[^>]*>|<ul[^>]*>.*?<li/i.test(html),
    hasFooter: /<footer[^>]*>/i.test(html),
    hasCookieBanner: /cookie|consent|bannier/i.test(html),
    colorContrastNote: "Manual review required — automated contrast check not available",
  };

  // 7. Conversion opportunities
  const conversion = {
    hasClearCTA: ux.hasCallToAction,
    hasContactForm: /<form[^>]*>.*?<input[^>]*type=["'](?:text|email|tel|number)["']/i.test(html),
    hasPhoneClickToCall: /tel:[0-9+]/i.test(html),
    hasSocialProof: /review|testimonial|trust|badge|starrating|\b[0-9]+\s*(?:review|star|testimonial)/i.test(html),
    hasLiveChat: /chat|intercom|drift|tidio|zendesk/i.test(html),
    hasMultipleCTAs: (html.match(/<a[^>]+href=["'][^"']*["'][^>]*>(?:sign up|get started|contact|book|order|buy|submit)/gi) || []).length,
  };

  // 8. Recommendations (AI-generated where possible)
  const recommendations = await generateRecommendations({
    seo, performance, content, ux, conversion, url, industry: input.industry || "",
  });

  const result = {
    url,
    fetchedAt: new Date().toISOString(),
    sections: {},
  };

  if (requested.includes("seo")) result.sections.seo = { ...seo, score: seoScore(seo) };
  if (requested.includes("performance")) result.sections.performance = { ...performance, score: performanceScore(performance) };
  if (requested.includes("technology")) result.sections.technology = { technologies, analysis: techAnalysis(technologies) };
  if (requested.includes("content")) result.sections.content = { ...content, score: contentScore(content) };
  if (requested.includes("ux")) result.sections.ux = { ...ux, score: uxScore(ux) };
  if (requested.includes("conversion")) result.sections.conversion = { ...conversion, opportunities: conversionOpportunities(conversion), score: conversionScore(conversion) };
  if (requested.includes("recommendations")) result.sections.recommendations = recommendations;

  return { success: true, data: result, metadata: { completedAt: new Date().toISOString() } };
}

function seoScore(s) {
  let score = 0;
  if (s.hasTitleTag) score += 15;
  if (s.titleLength >= 30 && s.titleLength <= 70) score += 15;
  if (s.hasMetaDescription) score += 15;
  if (s.metaDescriptionLength >= 50 && s.metaDescriptionLength <= 160) score += 10;
  if (s.hasH1 && s.h1Count === 1) score += 10;
  if (s.hasCanonical) score += 5;
  if (s.hasOGTags) score += 5;
  if (s.hasStructuredData) score += 5;
  return Math.min(100, score);
}

function performanceScore(p) {
  let score = 50;
  if (p.hasMinifiedCSS) score += 5;
  if (p.hasMinifiedJS) score += 5;
  if (p.hasCDN) score += 5;
  if (p.hasHTTP2Hints) score += 5;
  if (p.hasLazyLoading) score += 5;
  if (p.externalScripts < 10) score += 5;
  if (p.imageCount < 20) score += 5;
  return Math.min(100, score);
}

function contentScore(c) {
  let score = 0;
  if (c.hasText) score += 20;
  if (c.wordCount >= 300) score += 15;
  if (c.hasHeadings >= 2) score += 15;
  if (c.readingTimeMinutes >= 1 && c.readingTimeMinutes <= 10) score += 10;
  if (c.hasAltTexts > 0) score += 10;
  if (c.hasInternalLinks > 0) score += 10;
  if (c.imageWithAltRatio !== "N/A" && parseInt(c.imageWithAltRatio) >= 60) score += 10;
  return Math.min(100, score);
}

function uxScore(u) {
  let score = 0;
  if (u.hasMobileMeta) score += 20;
  if (u.hasNavigation) score += 15;
  if (u.hasFooter) score += 10;
  if (u.hasContactInfo) score += 10;
  if (u.hasCallToAction) score += 10;
  if (u.hasFavicon) score += 5;
  if (u.hasSearch) score += 5;
  if (u.hasCookieBanner) score += 5;
  return Math.min(100, score);
}

function conversionScore(c) {
  let score = 0;
  if (c.hasClearCTA) score += 20;
  if (c.hasContactForm) score += 20;
  if (c.hasPhoneClickToCall) score += 10;
  if (c.hasSocialProof) score += 15;
  if (c.hasMultipleCTAs >= 2) score += 15;
  if (c.hasLiveChat) score += 10;
  return Math.min(100, score);
}

function detectTechnologies(html) {
  const techs = [];
  const signatures = [
    { re: /wp-content|wp-includes|\/wp-json|wordpress/i, name: "WordPress" },
    { re: /shopify|cdn\.shopify\.com/i, name: "Shopify" },
    { re: /next\.js|__NEXT_DATA__|next\/dynamic/i, name: "Next.js" },
    { re: /react\.js|react\/|window\.React/i, name: "React" },
    { re: /vue\.js|vue\/|window\.Vue/i, name: "Vue.js" },
    { re: /angular\.js|angular\/|ng-app/i, name: "Angular" },
    { re: /svelte|svelte\.js/i, name: "Svelte" },
    { re: /gatsby|gatsbyjs/i, name: "Gatsby" },
    { re: /express|express\.js/i, name: "Express.js" },
    { re: /tailwind|tailwindcss/i, name: "Tailwind CSS" },
    { re: /bootstrap|bootstrap\.min\.js/i, name: "Bootstrap" },
    { re: /jquery|jquery\.min\.js/i, name: "jQuery" },
    { re: /stripe|stripe\.js|stripe\.com/i, name: "Stripe" },
    { re: /google-analytics|gtag\.js|analytics\.js/i, name: "Google Analytics" },
    { re: /google-tag-manager|gtm\.js|GTM-|gtm/i, name: "Google Tag Manager" },
    { re: /facebook.*pixel|fbq\(|facebook\.com\/plugins/i, name: "Facebook Pixel" },
    { re: /hotjar|hotjar\.com/i, name: "Hotjar" },
    { re: /intercom|intercom\.com|intercom\.js/i, name: "Intercom" },
    { re: /cloudflare/i, name: "Cloudflare" },
    { re: /font-awesome|fontawesome|fa-|fa\.css/i, name: "Font Awesome" },
    { re: /swiper|swiper\.js|swiper\.css/i, name: "Swiper" },
    { re: /algolia|algolia\.com|algoliasearch/i, name: "Algolia" },
    { re: /mixpanel|mixpanel\.com/i, name: "Mixpanel" },
    { re: /segment\.io|analytics\.js/i, name: "Segment" },
    { re: /sendgrid|sendgrid\.com|sg\.mail/i, name: "SendGrid" },
    { re: /mailchimp|mailchimp\.com|mc\.js/i, name: "Mailchimp" },
    { re: /vimeo\.com|vimeocdn/i, name: "Vimeo" },
    { re: /youtube\.com\/embed|youtube\.com\/iframe/i, name: "YouTube Embed" },
    { re: /maps\.google\.com|google maps|googlemaps/i, name: "Google Maps" },
    { re: /shopify\.com|cdn\.shopify/i, name: "Shopify" },
    { re: /squarespace|squarespace\.com/i, name: "Squarespace" },
    { re: /wix|wix\.com/i, name: "Wix" },
    { re: /drupal|drupal\.org/i, name: "Drupal" },
    { re: /joomla|joomla\.org/i, name: "Joomla" },
    { re: /magneto|magento\.com|skin\/frontend/i, name: "Magento" },
  ];
  for (const sig of signatures) {
    if (sig.re.test(html)) techs.push(sig.name);
  }
  return techs;
}

function techAnalysis(techs) {
  const categories = {
    CMS: techs.filter(t => ["WordPress", "Shopify", "Squarespace", "Wix", "Drupal", "Joomla", "Magento"].includes(t)),
    Framework: techs.filter(t => ["Next.js", "React", "Vue.js", "Angular", "Svelte", "Gatsby"].includes(t)),
    Ecommerce: techs.filter(t => ["Shopify", "Stripe", "Magento"].includes(t)),
    Analytics: techs.filter(t => ["Google Analytics", "Google Tag Manager", "Facebook Pixel", "Mixpanel", "Segment"].includes(t)),
    CDN: techs.filter(t => ["Cloudflare"].includes(t)),
  };
  return {
    total: techs.length,
    categories: Object.fromEntries(Object.entries(categories).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v])),
    notable: techs.slice(0, 10),
  };
}

function extractHeadings(html) {
  const headings = [];
  const re = /<h([1-6])[^>]*>([^<]*)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    headings.push({ level: parseInt(m[1]), text: m[2].trim() });
  }
  return headings.slice(0, 20);
}

function conversionOpportunities(c) {
  const opps = [];
  if (!c.hasClearCTA) opps.push("Add a clear, visible call-to-action above the fold");
  if (!c.hasContactForm) opps.push("Add a contact form to reduce friction for inquiries");
  if (!c.hasPhoneClickToCall) opps.push("Add click-to-call links for mobile users");
  if (!c.hasSocialProof) opps.push("Add testimonials or review badges to build trust");
  if (c.hasMultipleCTAs < 2) opps.push("Add multiple CTAs throughout the page for different user intents");
  if (!c.hasLiveChat) opps.push("Consider adding live chat for real-time customer engagement");
  if (opps.length === 0) opps.push("Conversion elements appear well-implemented — monitor performance and A/B test CTAs");
  return opps;
}

async function generateRecommendations(ctx) {
  // Build a summary for the AI
  const summary = `
Website: ${ctx.url}
SEO Score: ${ctx.seo?.score || "N/A"}/100
Performance Score: ${ctx.performance?.score || "N/A"}/100
Content Score: ${ctx.content?.score || "N/A"}/100
UX Score: ${ctx.ux?.score || "N/A"}/100
Conversion Score: ${ctx.conversion?.score || "N/A"}/100
Technologies: ${JSON.stringify(ctx.technology?.technologies || [])}
Title tag: ${ctx.seo?.hasTitleTag ? "present (" + ctx.seo?.titleLength + " chars)" : "MISSING"}
Meta description: ${ctx.seo?.hasMetaDescription ? "present (" + ctx.seo?.metaDescriptionLength + " chars)" : "MISSING"}
H1 tags: ${ctx.seo?.h1Count} (${ctx.seo?.hasH1 ? "has H1" : "MISSING H1"})
Word count: ${ctx.content?.wordCount || 0}
Images: ${ctx.performance?.imageCount || 0} (${ctx.content?.imageWithAltRatio || "N/A"} with alt text)
Heading structure: ${JSON.stringify(ctx.content?.headingStructure || []).slice(0, 300)}
`;

  try {
    const recs = await chatJson([
      { role: "system", content: "You are a website audit expert. Based on the audit data below, return a JSON object with: strengths (array of 3-5 strings), weaknesses (array of 3-5 strings), and actionItems (array of 5-8 actionable recommendations with priority: high/medium/low and a brief description). Only return valid JSON, no other text." },
      { role: "user", content: summary + "\n\nGenerate a structured audit recommendations report." },
    ], { temperature: 0.2 });
    if (recs && typeof recs === "object") return recs;
  } catch (err) {
    console.error("[website-audit] AI recommendations error:", err.message);
  }

  // Fallback: rule-based recommendations
  const fallback = {
    strengths: [],
    weaknesses: [],
    actionItems: [],
  };
  if (ctx.seo?.score >= 70) fallback.strengths.push("SEO fundamentals are well-implemented");
  if (ctx.performance?.score >= 70) fallback.strengths.push("Good performance optimizations detected");
  if (ctx.ux?.score >= 70) fallback.strengths.push("User experience elements are in place");
  if (!ctx.seo?.hasTitleTag) fallback.weaknesses.push("Missing title tag — critical for SEO");
  if (!ctx.seo?.hasMetaDescription) fallback.weaknesses.push("Missing meta description — affects click-through rate");
  if (!ctx.seo?.hasH1) fallback.weaknesses.push("Missing H1 tag — important for SEO and accessibility");
  if (ctx.content?.wordCount < 300) fallback.weaknesses.push("Thin content — consider expanding for SEO and user value");
  if (!ctx.conversion?.hasClearCTA) fallback.weaknesses.push("No clear call-to-action detected — users may not know what to do next");
  if (ctx.seo?.score < 70) fallback.actionItems.push({ priority: "high", description: "Add or optimize title tag and meta description for all pages" });
  if (!ctx.seo?.hasH1) fallback.actionItems.push({ priority: "high", description: "Add a single H1 tag that includes the primary keyword" });
  if (ctx.content?.wordCount < 500) fallback.actionItems.push({ priority: "medium", description: "Expand content to at least 500 words for better SEO and user engagement" });
  if (!ctx.conversion?.hasClearCTA) fallback.actionItems.push({ priority: "high", description: "Add prominent CTAs above the fold and at natural decision points" });
  if (ctx.performance?.imageCount > 10 && ctx.content?.imageWithAltRatio === "N/A") fallback.actionItems.push({ priority: "medium", description: "Add alt text to all images for accessibility and SEO" });
  if (!fallback.actionItems.length) fallback.actionItems.push({ priority: "low", description: "Run a full Lighthouse audit for detailed performance metrics" });
  return fallback;
}
