/**
 * SEO Content Pipeline — POST /api/workflows/seo-content
 *
 * Generates SEO-optimized content: keyword research context, title options,
 * meta description, heading structure, article content, FAQ section, and
 * structured data recommendations.
 */
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

function inferSearchIntent(kw) {
  const informational = ["how to", "what is", "guide", "tutorial", "learn", "explain", "best way", "tips", "beginner"];
  const commercial = ["best", "top", "review", "comparison", "vs", "alternatives", "pricing", "cost", "buy", "cheap"];
  const transactional = ["buy", "order", "price", "discount", "coupon", "deal", "free shipping"];
  const nav = ["login", "sign in", "account", "contact", "support", "near me"];
  const lower = kw.toLowerCase();
  if (nav.some((n) => lower.includes(n))) return "navigational";
  if (transactional.some((t) => lower.includes(t))) return "transactional";
  if (commercial.some((c) => lower.includes(c))) return "commercial";
  if (informational.some((i) => lower.includes(i))) return "informational";
  return "informational";
}

function buildValues(idea, blueprint) {
  const t = typeof idea === "string" ? idea.toLowerCase() : "";
  const has_revenue = !!(blueprint?.revenue || blueprint?.revenue_model);
  const rev = (blueprint?.revenue || blueprint?.revenue_model || "").toString().toLowerCase();
  const is_service = rev.includes("service") || t.includes("consult") || t.includes("agency") || t.includes("coaching") || t.includes("cleaning") || t.includes("repair") || t.includes("landscaping") || t.includes("plumbing") || t.includes("hvac") || t.includes("roofing");
  const is_retail = rev.includes("retail") || rev.includes("product") || t.includes("store") || t.includes("shop") || t.includes("cafe") || t.includes("restaurant") || t.includes("bakery") || t.includes("salon") || t.includes("gym") || t.includes("studio");
  const has_inventory = rev.includes("inventory") || is_retail || t.includes("sell") || t.includes("sales");
  return {
    business_type: is_service ? "service-based" : is_retail ? "retail/bricks-and-clicks" : "hybrid",
    has_revenue: has_revenue,
    has_inventory: has_inventory,
    is_service: is_service,
    is_retail: is_retail,
  };
}

export async function seoContent(input, req) {
  // Accept both spec and legacy field names
  const keyword = input.keyword || input.primary_keyword;
  const topic = input.topic;
  const word_count = input.word_count || input.content_length || 2000;
  const search_intent = input.search_intent;
  const content_type = input.content_type || input.contentType;
  const tone = input.tone || "informative";
  const target_audience = input.target_audience || "general";
  const include_faq = input.include_faq ?? input.include_faq !== false;
  const include_schema = input.include_schema ?? input.include_schema !== false;
  const include_titles = input.include_titles ?? true;
  const include_meta = input.include_meta ?? true;
  const include_headings = input.include_headings ?? true;
  const include_schema_markup = input.include_schema_markup ?? input.include_schema ?? true;

  if (!keyword && !topic) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"keyword" or "topic" is required' } };
  }
  if (typeof keyword !== "string" || keyword.trim().length < 2) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"keyword" must be a string with at least 2 characters' } };
  }
  if (word_count < 100 || word_count > 5000) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"word_count" must be between 100 and 5000' } };
  }

  const intent = search_intent || inferSearchIntent(keyword);
  const len = Math.min(Math.max(200, word_count), 5000);

  const system = "You are an SEO content specialist. Return ONLY valid JSON, no markdown, no other text. Generate search-optimized content based on the keyword and intent provided. Include the elements requested in the output structure. All content should be original, useful, and follow SEO best practices.";

  const userContent = `Generate SEO-optimized content for the following:
Keyword: ${keyword}
Topic: ${topic || keyword}
Search Intent: ${intent}
Content Type: ${content_type || "blog_post"}
Target Word Count: ${len}
Tone: ${tone}
Target Audience: ${target_audience}

Return a JSON object with:
- keyword (the target keyword)
- search_intent (informational, commercial, transactional, or navigational)
- title_options (array of 3-5 SEO-optimized title suggestions)
- meta_description (150-160 character meta description)
- heading_structure (array of h2-h4 headings for the content)
- content (the main article content, approximately ${len} words)
- seo_recommendations (array of 5-10 SEO tips specific to this keyword)
- faq_section (array of {question, answer} objects, 5-8 FAQs — omit if include_faq is false)
- structured_data (object with recommended JSON-LD schema types and key fields — omit if include_schema is false)
- keyword_placement (object showing where the keyword appears: title, meta, headings, first_paragraph, body — with counts)

${include_titles ? "Include title_options." : "Omit title_options."}
${include_meta ? "Include meta_description." : "Omit meta_description."}
${include_headings ? "Include heading_structure." : "Omit heading_structure."}
${include_faq ? "Include faq_section with 5-8 FAQs." : "Omit faq_section."}
${include_schema ? "Include structured_data with JSON-LD schema recommendations." : "Omit structured_data."}

Only return valid JSON. No markdown, no other text.`;

  try {
    const result = await chatJson(
      [{ role: "system", content: system }, { role: "user", content: userContent }],
      { temperature: 0.3, max_tokens: 5000, enforceTimeoutMs: 20000 }
    );

    if (result) {
      result.generated_from = { keyword, topic, search_intent: intent, word_count: len, content_type: content_type || "blog_post", tone, target_audience, include_faq, include_schema };
      result.seo_score_estimate = estimateSeoScore(result, keyword, intent);
    }
    return { success: true, data: result || { keyword, search_intent: intent, content: "SEO content for " + keyword }, metadata: { completedAt: new Date().toISOString() } };
  } catch (err) {
    console.error("[seo-content] AI error:", err.message);
    return { success: true, data: fallbackSeoContent(keyword, intent, len, include_faq, include_schema, include_titles, include_meta, include_headings), metadata: { completedAt: new Date().toISOString() } };
  }
}

function estimateSeoScore(data, keyword, intent) {
  let score = 50;
  if (data?.title_options?.length >= 3) score += 10;
  if (data?.meta_description && data.meta_description.length >= 120) score += 5;
  if (data?.heading_structure?.length >= 3) score += 10;
  if (data?.keyword_placement) {
    const kp = data.keyword_placement;
    if (kp.title) score += 5;
    if (kp.first_paragraph) score += 5;
    if (kp.headings && kp.headings >= 2) score += 5;
  }
  if (data?.seo_recommendations?.length >= 5) score += 10;
  if (data?.faq_section?.length >= 3) score += 5;
  if (data?.structured_data) score += 5;
  return Math.min(100, Math.max(0, score));
}

function fallbackSeoContent(keyword, intent, wordCount, includeFaq, includeSchema, includeTitles, includeMeta, includeHeadings) {
  const title = capitalizeFirst(keyword) + ": The Complete Guide";
  const meta = `Learn everything about ${keyword}. Our comprehensive guide covers key strategies, best practices, and expert tips to help you succeed with ${keyword}.`;
  return {
    keyword,
    search_intent: intent,
    title_options: includeTitles ? [title, `How to Master ${capitalizeFirst(keyword)}`, `${capitalizeFirst(keyword)}: Tips, Strategies, and Best Practices`, `The Ultimate ${capitalizeFirst(keyword)} Resource`, `Everything You Need to Know About ${capitalizeFirst(keyword)}`] : undefined,
    meta_description: includeMeta ? meta : undefined,
    heading_structure: includeHeadings ? [
      { level: "h1", text: title },
      { level: "h2", text: "What Is " + capitalizeFirst(keyword) + "?" },
      { level: "h2", text: "Why " + capitalizeFirst(keyword) + " Matters" },
      { level: "h2", text: "Key Strategies for " + capitalizeFirst(keyword) },
      { level: "h3", text: "Strategy 1: Getting Started" },
      { level: "h3", text: "Strategy 2: Best Practices" },
      { level: "h3", text: "Strategy 3: Common Mistakes to Avoid" },
      { level: "h2", text: "Tools and Resources for " + capitalizeFirst(keyword) },
      { level: "h2", text: "FAQ About " + capitalizeFirst(keyword) },
      { level: "h2", text: "Conclusion" },
    ] : undefined,
    content: generateFallbackContent(keyword, intent, wordCount),
    seo_recommendations: [
      "Include the target keyword in the page title (title tag)",
      "Use the keyword naturally in the first 100 words of content",
      "Optimize meta description to 150-160 characters with a clear call to action",
      "Use keyword variations and related terms throughout the content",
      "Structure content with clear heading hierarchy (H1, H2, H3)",
      "Add internal links to related pages on your site",
      "Optimize images with descriptive alt text including the keyword where relevant",
      "Ensure fast page load speed (under 3 seconds)",
      "Make content mobile-friendly and responsive",
      "Build quality backlinks from authoritative, relevant sites",
      "Update content regularly to keep it fresh and relevant",
      "Include a clear call to action aligned with the search intent",
    ],
    faq_section: includeFaq ? [
      { question: "What is " + keyword + "?", answer: " " + capitalizeFirst(keyword) + " refers to the strategies, tools, and practices used to improve search engine visibility and drive organic traffic. It involves research, content optimization, and technical improvements." },
      { question: "Why is " + keyword + " important?", answer: " Effective " + keyword + " helps your content rank higher in search results, driving more qualified traffic to your site. This leads to increased visibility, credibility, and potential conversions." },
      { question: "How long does " + keyword + " take to show results?", answer: " Results vary based on competition, current authority, and effort. Generally, significant improvements can be seen in 3-6 months with consistent effort, though some changes may show faster results." },
      { question: "What are the key components of " + keyword + "?", answer: " Key components include keyword research, high-quality content creation, on-page optimization (titles, meta, headings), technical SEO (site speed, mobile-friendliness), and building authoritative backlinks." },
      { question: "Can I do " + keyword + " myself?", answer: " Yes — many aspects of " + keyword + " can be done in-house with the right knowledge and tools. Start with keyword research, basic on-page optimization, and quality content creation. Consider professional help for technical issues or competitive niches." },
      { question: "How often should I update " + keyword + " content?", answer: " Review and update " + keyword + " content every 3-6 months to keep it accurate, relevant, and competitive. Search engines favor fresh, up-to-date content, especially for rapidly changing topics." },
    ] : undefined,
    structured_data: includeSchema ? {
      recommended_schema_types: ["Article", "BreadcrumbList", "FAQPage" + (includeFaq ? "" : " (only if FAQ section is present)")],
      key_fields: {
        headline: "Use the optimized title here",
        description: "Use the meta description here",
        author: "Specify article author",
        datePublished: "ISO 8601 date",
        image: "Featured image URL",
        keywords: "Comma-separated relevant keywords",
      },
      implementation_note: "Add JSON-LD script to the page head or body. Validate with Google's Rich Results Test.",
    } : undefined,
    keyword_placement: {
      title: includeTitles ? 1 : 0,
      meta: includeMeta ? 1 : 0,
      headings: includeHeadings ? Math.min(3, Math.floor(wordCount / 500)) : 0,
      first_paragraph: 1,
      body: Math.floor(wordCount / 300),
      total_estimated: includeTitles + includeMeta + (includeHeadings ? 1 : 0) + 1 + Math.floor(wordCount / 300),
    },
    generated_from: { keyword, search_intent: intent, word_count: wordCount, tone: "informative", target_audience: "general", include_faq: includeFaq, include_schema: includeSchema, mode: "fallback" },
    seo_score_estimate: estimateSeoScore({ title_options: includeTitles ? [title] : [], meta_description: includeMeta ? meta : "", heading_structure: includeHeadings ? [{ level: "h1", text: title }] : [], seo_recommendations: [], faq_section: includeFaq ? [{ question: "What is " + keyword + "?", answer: "placeholder" }] : [], structured_data: includeSchema ? {} : undefined, keyword_placement: {} }, keyword, intent),
  };
}

function generateFallbackContent(keyword, intent, wordCount) {
  const paraCount = Math.max(3, Math.floor(wordCount / 150));
  const paragraphs = [
    `In this comprehensive guide, we explore everything you need to know about ${keyword}. Whether you're just getting started or looking to deepen your understanding, this article covers the essential concepts, strategies, and best practices that will help you succeed. ${keyword} has become increasingly important in today's digital landscape, and mastering it can provide significant advantages.`,
    `To understand ${keyword} effectively, it's important to first grasp the fundamental principles. At its core, ${keyword} involves a combination of research, planning, execution, and measurement. The key is to approach it systematically, starting with a clear understanding of your goals and your audience. This foundation will guide every decision you make throughout the process.`,
    `There are several proven strategies for implementing ${keyword} successfully. First, thorough research is essential — understand your niche, your competitors, and the specific opportunities available to you. Second, create high-quality, relevant content that addresses your audience's needs and questions. Third, optimize every element of your approach, from technical setup to user experience. Finally, measure your results and iterate based on what the data tells you.`,
    `Common mistakes to avoid when working with ${keyword} include: neglecting the basics (like proper research and planning), focusing too much on short-term tactics at the expense of long-term strategy, ignoring user experience and page speed, creating thin or low-quality content, and failing to track and measure results. Avoiding these pitfalls will put you ahead of many competitors who overlook these fundamentals.`,
    `The tools and resources available for ${keyword} have expanded significantly in recent years. From keyword research tools and analytics platforms to content optimization software and competitor analysis resources, there's no shortage of options. The key is to choose tools that fit your budget, your skill level, and your specific needs. Start with a few essential tools and expand as you grow.`,
    `Looking ahead, the landscape of ${keyword} continues to evolve. Staying informed about the latest trends, algorithm updates, and best practices is essential for long-term success. Join communities, follow industry experts, and invest in continuous learning to stay ahead of the curve. The businesses and professionals who adapt quickly to changes in ${keyword} will be best positioned for future success.`,
  ];
  let content = paragraphs.join("\n\n");
  while (content.split(" ").length < wordCount && paragraphs.length < 20) {
    paragraphs.push(`Additional insight on ${keyword}: Understanding the nuances of this topic requires attention to detail and a willingness to learn. Every situation is unique, so adapt these general principles to your specific circumstances. The most successful practitioners of ${keyword} are those who combine solid fundamentals with creativity and a customer-first mindset. They understand that ${keyword} is not just about technical execution — it's about delivering value to the people you serve. By focusing on quality, consistency, and continuous improvement, you can build a strong foundation that supports long-term growth and success in the ${keyword} space.`);
    content = paragraphs.join("\n\n");
  }
  return content;
}

function capitalizeFirst(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
