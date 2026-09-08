/**
 * Content Factory Workflow — POST /api/workflows/content-factory
 *
 * Generates social media content at scale: hooks, scripts, captions, hashtags,
 * calls to action, and posting recommendations for TikTok, Instagram,
 * Twitter/X, LinkedIn, YouTube Shorts, and Facebook.
 *
 * Pricing tiers: small (1-5 items), medium (6-20), large (21-50).
 */
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function contentFactory(input, req) {
  const { topic, platform, quantity = 10, tone = "engaging", brandVoice = "", package: pkg = "medium" } = input;

  if (!topic || typeof topic !== "string") {
    return { success: false, error: { code: "VALIDATION_ERROR", message: '"topic" is required' } };
  }

  const validPlatforms = ["tiktok", "instagram", "twitter", "linkedin", "youtube_shorts", "facebook", "multi"];
  if (platform && !validPlatforms.includes(platform)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"platform" must be one of: ${validPlatforms.join(", ")}` } };
  }

  const validPackages = ["small", "medium", "large"];
  if (!validPackages.includes(pkg)) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: `"package" must be one of: ${validPackages.join(", ")}` } };
  }

  const safeQuantity = Math.min(Math.max(1, quantity || 10), 50);
  const effectivePackage = pkg || (safeQuantity <= 5 ? "small" : safeQuantity <= 20 ? "medium" : "large");
  const maxItems = effectivePackage === "small" ? 5 : effectivePackage === "medium" ? 20 : 50;
  const actualQuantity = Math.min(safeQuantity, maxItems);

  const systemPrompt = `You are a social media content creator. Generate content for the topic: "${topic}" on ${platform || "multiple platforms"}.

Tone: ${tone || "engaging"}
Brand voice: ${brandVoice || "authentic, helpful, professional"}

Return a JSON object with:
- hooks: array of ${Math.min(actualQuantity, 10)} short attention-grabbing hook lines (first 3 seconds of video or opening line of post)
- content_ideas: array of ${actualQuantity} content ideas, each with: idea (short title), angle (what angle to take), platform (which platform it works best on), format (video/carousel/thread/post/story)
- scripts: array of ${Math.min(actualQuantity, 5)} short video scripts, each with: hook, body (the main content), CTA (call to action), estimatedDuration (e.g. "30 seconds")
- captions: array of ${Math.min(actualQuantity, 10)} caption options, each with: caption (the post text), hashtags (array of 5-10 relevant hashtags)
- hashtag_suggestions: array of 15-25 hashtags relevant to the topic, grouped by popularity (high/medium/niche)
- posting_recommendations: array of {platform, bestTime, frequency, tip} for each platform
- cta_options: array of 5-10 call-to-action phrases
- content_calendar: array of ${Math.min(actualQuantity, 7)} suggested posts with: day, platform, content_type, hook, caption_preview

Only return valid JSON. No other text. Make content original, engaging, and tailored to the topic.`;

  let result = null;
  try {
    result = await chatJson([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Generate ${actualQuantity} pieces of content for the topic "${topic}" on ${platform || "multiple platforms"}. Package: ${effectivePackage}.` },
    ], { temperature: 0.7, max_tokens: 4096 });
  } catch (err) {
    console.error("[content-factory] AI generation error:", err.message);
    result = generateFallbackContent(topic, platform, actualQuantity, effectivePackage);
  }

  if (!result) result = generateFallbackContent(topic, platform, actualQuantity, effectivePackage);

  const normalized = {
    topic,
    platform: platform || "multi",
    package: effectivePackage,
    generatedAt: new Date().toISOString(),
    hooks: result.hooks || [],
    content_ideas: (result.content_ideas || []).slice(0, actualQuantity),
    scripts: result.scripts || [],
    captions: result.captions || [],
    hashtag_suggestions: result.hashtag_suggestions || [],
    posting_recommendations: result.posting_recommendations || [],
    cta_options: result.cta_options || [],
    content_calendar: result.content_calendar || [],
  };

  return {
    success: true,
    data: normalized,
    metadata: {
      completedAt: new Date().toISOString(),
      package: effectivePackage,
      itemsGenerated: {
        hooks: normalized.hooks.length,
        content_ideas: normalized.content_ideas.length,
        scripts: normalized.scripts.length,
        captions: normalized.captions.length,
        calendar: normalized.content_calendar.length,
      },
    },
  };
}

function generateFallbackContent(topic, platform, quantity, pkg) {
  const hooks = [
    `Did you know about ${topic}?`,
    `Here's what nobody tells you about ${topic}`,
    `The truth about ${topic} will surprise you`,
    `Stop making this mistake with ${topic}`,
    `How to master ${topic} in 3 steps`,
    `${topic} changed everything for me`,
    `Nobody talks about this ${topic} strategy`,
    `The ${topic} hack that saved me hours`,
    `Why ${topic} is more important than you think`,
    `${topic} lesson learned the hard way`,
  ];
  const contentIdeas = [];
  for (let i = 0; i < quantity; i++) {
    contentIdeas.push({
      idea: `Content idea ${i + 1}: ${topic} — ${["beginner", "advanced", "mistakes", "tips", "strategy", "case study", "how-to", "myth busting", "review", "comparison"][i % 10]} angle`,
      angle: ["Educational", "Contrarian", "Step-by-step", "Personal story", "Data-driven", "Comparison", "Mistake-focused", "Myth-busting", "Tutorial", "Behind-the-scenes"][i % 10],
      platform: platform || ["tiktok", "instagram", "linkedin", "twitter", "youtube_shorts"][i % 5],
      format: ["video", "carousel", "thread", "post", "story"][i % 5],
    });
  }
  const scripts = [];
  for (let i = 0; i < Math.min(quantity, 3); i++) {
    scripts.push({
      hook: hooks[i % hooks.length],
      body: `Here's the deal with ${topic}. Most people get this wrong, but the real secret is simpler than you think. First, understand the fundamentals. Then apply these practical steps. Finally, measure your results and adjust.`,
      CTA: ["Save this for later", "Follow for more tips", "Try this and let me know", "Share this with someone who needs it"][i % 4],
      estimatedDuration: ["15 seconds", "30 seconds", "45 seconds", "60 seconds"][i % 4],
    });
  }
  const captions = [];
  for (let i = 0; i < Math.min(quantity, 5); i++) {
    captions.push({
      caption: `Thoughts on ${topic}? ${["👇", "🔥", "💡", "✅", "🚀"][i % 5]} Let me know in the comments. #${topic.replace(/\s+/g, "")} #content #tips`,
      hashtags: [`#${topic.replace(/\s+/g, "")}`, "#content", "#tips", "#business", "#strategy", "#growth", "#marketing", "#learn", "#education", "#daily"].slice(0, 5 + (i % 5)),
    });
  }
  return {
    hooks: hooks.slice(0, Math.min(quantity, 10)),
    content_ideas: contentIdeas,
    scripts: scripts,
    captions: captions,
    hashtag_suggestions: [
      ...["#viral", "#trending", "#fyp", "#explore", "#contentcreator"].slice(0, 3 + (pkg === "large" ? 3 : 0)),
      `#${topic.replace(/\s+/g, "")}`,
      `#${topic.replace(/\s+/g, "")}Tips`,
      `#${topic.replace(/\s+/g, "")}Strategy`,
    ],
    posting_recommendations: [
      { platform: "tiktok", bestTime: "6-9 PM weekdays", frequency: "1-3x daily", tip: "Post when your audience is most active; engage with comments in first 30 minutes" },
      { platform: "instagram", bestTime: "11 AM - 1 PM or 7-9 PM", frequency: "1x daily for stories, 3-5x weekly for posts", tip: "Use carousels for educational content, stories for behind-the-scenes" },
      { platform: "linkedin", bestTime: "8-10 AM or 12-2 PM weekdays", frequency: "3-5x weekly", tip: "Professional tone, share insights and lessons learned, engage with comments" },
      { platform: "twitter", bestTime: "8-10 AM or 12-1 PM weekdays", frequency: "2-5x daily", tip: "Threads perform well for deep dives; keep individual tweets punchy" },
      { platform: "youtube_shorts", bestTime: "5-8 PM weekdays", frequency: "3-5x weekly", tip: "Hook in first 3 seconds; use captions for silent viewing" },
    ],
    cta_options: [
      "Save this for later",
      "Follow for more",
      "Share with someone who needs this",
      "Comment your thoughts below",
      "Try this and tag me",
      "Link in bio for more",
      "DM me for details",
      "Subscribe for weekly tips",
      "Drop a comment if this helped",
      "Share to your story",
    ],
    content_calendar: Array.from({ length: Math.min(quantity, 7) }, (_, i) => ({
      day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i],
      platform: platform || ["tiktok", "instagram", "linkedin", "twitter", "youtube_shorts", "instagram", "linkedin"][i],
      content_type: ["educational", "behind-the-scenes", "tip", "story", "comparison", "myth-busting", "case study"][i],
      hook: hooks[i % hooks.length],
      caption_preview: captions[i % captions.length]?.caption?.slice(0, 80) || "",
    })),
  };
}
