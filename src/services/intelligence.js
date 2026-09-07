/**
 * Website Intelligence — scraping service
 *
 * Extracts structured intelligence from a target URL:
 *   title, description, image, favicon, social_links[], contacts[], technologies[], content_summary
 */
import https from "https";
import http from "http";

const USER_AGENT = "Mozilla/5.0 (compatible; MAMMBA-x402-Intelligence/1.0)";
const TIMEOUT_MS  = parseInt(process.env.INTELLIGENCE_TIMEOUT_MS || "15000", 10);

// ─── helpers ────────────────────────────────────────────────────────────────────

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      },
      (res) => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Upstream returned ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.get(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      },
      (res) => {
        if (res.statusCode >= 400) return reject(new Error(`Upstream returned ${res.statusCode}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new Error("Bad JSON")); }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ─── Microlink metadata (fast, reliable OG extraction) ─────────────────────────

async function microlinkMetadata(url) {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
  const data = await fetchJson(apiUrl);
  if (!data || data.status !== "success" || !data.data) return null;
  const d = data.data;
  return {
    title:       d.title        || null,
    description: d.description  || null,
    image:       d.image?.url   || (d.logo?.url || null),
    favicon:     d.logo?.url    || null,
    lang:        d.lang         || null,
    author:      d.author       || null,
  };
}

// ─── DOM analysis (runs on the fetched HTML) ────────────────────────────────────

function extractFromHtml(html, baseUrl) {
  const doc = htmlToDom(html);
  if (!doc) return {};
  const base = new URL(baseUrl);

  const ogTitle       = pick(doc, 'meta[property="og:title"]',        "content");
  const ogDescription = pick(doc, 'meta[property="og:description"]',   "content");
  const ogImage       = pick(doc, 'meta[property="og:image"]',         "content");
  const twitterTitle  = pick(doc, 'meta[name="twitter:title"]',        "content");
  const twitterDesc   = pick(doc, 'meta[name="twitter:description"]',  "content");
  const twitterImg    = pick(doc, 'meta[name="twitter:image"]',        "content");
  const metaDesc      = pick(doc, 'meta[name="description"]',          "content");

  const title = ogTitle || twitterTitle || doc.querySelector("title")?.textContent?.trim() || "";
  const description = ogDescription || twitterDesc || metaDesc || "";

  let image = ogImage || twitterImg || null;
  if (!image) {
    const hero = doc.querySelector('img.hero, img.hero-image, .hero img, [itemprop="image"]');
    if (hero) image = hero.getAttribute("src") || hero.getAttribute("data-src") || null;
  }
  if (image) image = resolveUrl(image, base);

  let favicon = null;
  const linkFavicon = pick(doc, 'link[rel="icon"], link[rel="shortcut icon"]', "href");
  const appleTouch  = pick(doc, 'link[rel="apple-touch-icon"]', "href");
  if (linkFavicon) favicon = resolveUrl(linkFavicon, base);
  else if (appleTouch) favicon = resolveUrl(appleTouch, base);
  if (!favicon) {
    try { favicon = `${base.origin}/favicon.ico`; } catch {}
  }

  const socialLinks = extractSocialLinks(doc, base);
  const contacts = extractContacts(doc, base);
  const technologies = detectTechnologies(doc, html);
  const contentSummary = extractContentSummary(doc);

  return {
    title,
    description: description.trim(),
    image,
    favicon,
    social_links: socialLinks,
    contacts,
    technologies,
    content_summary: contentSummary.trim(),
  };
}

// ─── jsdom-backed DOM parser ────────────────────────────────────────────────────

let _JSDOM = null;
async function loadJSDOM() {
  if (_JSDOM) return _JSDOM;
  try {
    const m = await import("jsdom");
    _JSDOM = m.default || m.JSDOM || null;
  } catch {
    _JSDOM = null;
  }
  return _JSDOM;
}

function htmlToDom(html) {
  const JSDOM = _JSDOM;
  if (JSDOM) {
    try {
      const doc = new JSDOM(html, { runScripts: "outside-only" }).window.document;
      return doc;
    } catch {
      return null;
    }
  }
  return { _fallback: true, html };
}

// ─── query helpers ──────────────────────────────────────────────────────────────

function pick(doc, selector, attr) {
  if (!doc || doc._fallback) return null;
  const el = queryOne(doc, selector);
  if (!el) return null;
  if (attr) {
    if (el.getAttribute) return el.getAttribute(attr);
    return el[attr] || null;
  }
  if (el.textContent != null) return el.textContent.trim();
  return null;
}

function queryOne(doc, sel) {
  const metaMatch = sel.match(/^meta\[([^\]]+)\]$/);
  if (metaMatch) {
    const cond = metaMatch[1];
    const eqIdx = cond.indexOf("=");
    let key, val;
    if (eqIdx >= 0) {
      key = cond.slice(0, eqIdx).trim();
      val = cond.slice(eqIdx + 1).replace(/"/g, "").trim();
    } else {
      key = cond.trim();
      val = null;
    }
    return Array.from(doc.getElementsByTagName("meta")).find((m) => {
      const a = m.getAttribute(key);
      return val ? a === val : !!a;
    }) || null;
  }

  const linkMatch = sel.match(/^link\[([^\]]+)\]$/);
  if (linkMatch) {
    const cond = linkMatch[1];
    const eqIdx = cond.indexOf("=");
    let key, val;
    if (eqIdx >= 0) {
      key = cond.slice(0, eqIdx).trim();
      val = cond.slice(eqIdx + 1).replace(/"/g, "").trim();
    } else {
      key = cond.trim();
      val = null;
    }
    return Array.from(doc.getElementsByTagName("link")).find((m) => {
      const a = m.getAttribute(key);
      return val ? a === val : !!a;
    }) || null;
  }

  const classMatch = sel.match(/^(img\.)?([\w-]+)$/);
  if (classMatch && sel.startsWith("img.")) {
    const cls = classMatch[2];
    return Array.from(doc.getElementsByTagName("img")).find((i) => i.className?.includes(cls)) || null;
  }
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return Array.from(doc.getElementsByTagName("*")).find((n) => n.className?.includes(cls)) || null;
  }

  if (sel.startsWith("#")) {
    const id = sel.slice(1);
    return doc.getElementById(id) || null;
  }

  const tag = sel.split(/[.#\[]/)[0];
  return doc.getElementsByTagName(tag)[0] || null;
}

function queryAll(doc, sel) {
  if (doc._fallback) return [];

  const aMatch = sel.match(/^a\[([^\]]+)\]$/);
  if (aMatch) {
    const cond = aMatch[1];
    const eqIdx = cond.indexOf("=");
    let key, val;
    if (eqIdx >= 0) {
      key = cond.slice(0, eqIdx).trim();
      val = cond.slice(eqIdx + 1).replace(/"/g, "").trim();
    } else {
      key = cond.trim();
      val = null;
    }
    return Array.from(doc.getElementsByTagName("a")).filter((a) => {
      const av = a.getAttribute(key);
      return val ? av === val : !!av;
    });
  }

  const tag = sel.split(/[.#\[]/)[0];
  return Array.from(doc.getElementsByTagName(tag));
}

function resolveUrl(href, base) {
  if (!href) return null;
  try { return new URL(href, base).href; }
  catch { return href; }
}

// ─── social link extraction ─────────────────────────────────────────────────────

function extractSocialLinks(doc, base) {
  if (!doc || doc._fallback) return [];
  const platforms = [
    { name: "facebook",   patterns: [/facebook\.com\/@[^\/]+/, /facebook\.com\/[^\/]+\/[^\/]+/] },
    { name: "twitter",    patterns: [/twitter\.com\/[^\/]+/, /x\.com\/[^\/]+/] },
    { name: "instagram",  patterns: [/instagram\.com\/[^\/]+/] },
    { name: "linkedin",   patterns: [/linkedin\.com\/company\/[^\/]+/, /linkedin\.com\/in\/[^\/]+/] },
    { name: "youtube",    patterns: [/youtube\.com\/@[^\/]+/, /youtube\.com\/channel\/[^\/]+/, /youtube\.com\/c\/[^\/]+/] },
    { name: "tiktok",     patterns: [/tiktok\.com\/@?[^\/]+/] },
    { name: "github",     patterns: [/github\.com\/[^\/]+/] },
    { name: "telegram",   patterns: [/t\.me\/[^\/]+/] },
    { name: "discord",    patterns: [/discord\.com\/invite\/[^\/]+/, /discord\.gg\/[^\/]+/] },
  ];

  const seen = new Set();
  const results = [];

  const anchors = queryAll(doc, "a");
  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href) continue;
    for (const plat of platforms) {
      for (const pat of plat.patterns) {
        if (pat.test(href) && !seen.has(href)) {
          seen.add(href);
          results.push({ platform: plat.name, url: href });
          break;
        }
      }
    }
  }

  const metaSelectors = [
    'meta[property="facebook:site_name"]',
    'meta[property="og:url"]',
  ];
  for (const sel of metaSelectors) {
    const val = pick(doc, sel, "content");
    if (val && !seen.has(val)) {
      for (const plat of platforms) {
        for (const pat of plat.patterns) {
          if (pat.test(val)) {
            seen.add(val);
            results.push({ platform: plat.name, url: val });
            break;
          }
        }
      }
    }
  }

  return results.slice(0, 20);
}

// ─── contact extraction ─────────────────────────────────────────────────────────

function extractContacts(doc, base) {
  if (!doc || doc._fallback) return [];
  const contacts = [];
  const seen = new Set();

  const allText = (doc.querySelector("body")?.textContent || "");
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = emailRegex.exec(allText)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      contacts.push({ type: "email", value: m[0] });
    }
  }
  const mailtos = queryAll(doc, 'a[href^="mailto:"]');
  for (const a of mailtos) {
    const href = a.getAttribute("href")?.replace(/^mailto:/, "");
    if (href && !seen.has(href)) {
      seen.add(href);
      contacts.push({ type: "email", value: href });
    }
  }

  const phoneRegex = /\+?\d[\d\s()+-]{6,}\d/g;
  while ((m = phoneRegex.exec(allText)) !== null) {
    const cleaned = m[0].replace(/\s+/g, " ").trim();
    if (cleaned.length >= 7 && !seen.has(cleaned)) {
      seen.add(cleaned);
      contacts.push({ type: "phone", value: cleaned });
    }
  }

  try {
    const scripts = queryAll(doc, 'script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      const item = Array.isArray(data) ? data[0] : data;
      if (item?.email && !seen.has(item.email)) {
        seen.add(item.email);
        contacts.push({ type: "email", value: item.email });
      }
      if (item?.telephone && !seen.has(item.telephone)) {
        seen.add(item.telephone);
        contacts.push({ type: "phone", value: item.telephone });
      }
      if (item?.address?.streetAddress) {
        contacts.push({
          type: "address",
          value: [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion].filter(Boolean).join(", ")
        });
      }
    }
  } catch {}

  return contacts.slice(0, 10);
}

// ─── technology detection ────────────────────────────────────────────────────────

function detectTechnologies(doc, rawHtml) {
  if (!doc || doc._fallback) return [];
  const techs = new Set();

  const generator = pick(doc, 'meta[name="generator"]', "content");
  if (generator) techs.add(generator.split(" ")[0]);

  const scripts = queryAll(doc, "script");
  const srcs = scripts.map(s => s.getAttribute("src") || "").join(" ");
  const bodies = scripts.map(s => s.textContent || "").join(" ").slice(0, 10000);

  const signatures = [
    { re: /wp-content\/|wp-includes/|wordpress/i,               name: "WordPress" },
    { re: /Shopify|shopify\.com/i,                               name: "Shopify" },
    { re: /next\.js|__NEXT_DATA__|next\/head/i,                   name: "Next.js" },
    { re: /react\.js|React/gi,                                  name: "React" },
    { re: /vue\.js|vuejs/i,                                      name: "Vue.js" },
    { re: /angular\.js|Angular/gi,                              name: "Angular" },
    { re: /svelte|svelte\.js/i,                                  name: "Svelte" },
    { re: /gatsby|gatsbyjs/i,                                     name: "Gatsby" },
    { re: /express|express\.js/i,                                name: "Express.js" },
    { re: /tailwind|tailwindcss/i,                               name: "Tailwind CSS" },
    { re: /bootstrap|bootstrap\.js/i,                           name: "Bootstrap" },
    { re: /font-awesome|fontawesome/i,                           name: "Font Awesome" },
    { re: /gsap|greensock/i,                                      name: "GSAP" },
    { re: /jquery|jquery\.min\.js/i,                             name: "jQuery" },
    { re: /swiper|swiper\.js/i,                                  name: "Swiper" },
    { re: /stripe|stripe\.js/i,                                  name: "Stripe" },
    { re: /google-analytics|gtag\.js/i,                          name: "Google Analytics" },
    { re: /facebook\.com\/plugins|fbq\(/i,                       name: "Facebook Pixel" },
    { re: /google-tag-manager|GTM-/i,                             name: "Google Tag Manager" },
    { re: /cloudflare/i,                                          name: "Cloudflare" },
    { re: /vimeo\.com/i,                                         name: "Vimeo" },
    { re: /youtube\.com\/embed|youtube\.com\/iframe/i,          name: "YouTube Embed" },
    { re: /maps\.google\.com|google maps/i,                     name: "Google Maps" },
    { re: /algolia|algolia\.js/i,                                name: "Algolia" },
    { re: /intercom\.io|Intercom/i,                              name: "Intercom" },
    { re: /hotjar\.com|Hotjar/i,                                 name: "Hotjar" },
    { re: /mixpanel\.com|mixpanel/i,                             name: "Mixpanel" },
    { re: /segment\.io|analytics\.js/i,                         name: "Segment" },
    { re: /sendgrid|sg\.mail/i,                                  name: "SendGrid" },
    { re: /mailchimp|mc\d\.js/i,                                 name: "Mailchimp" },
  ];
  for (const sig of signatures) {
    if (sig.re.test(srcs + " " + bodies)) techs.add(sig.name);
  }

  if (/drupal/i.test(rawHtml)) techs.add("Drupal");
  if (/joomla/i.test(rawHtml)) techs.add("Joomla");
  if (/wp-/i.test(bodies) || /wp-/i.test(srcs)) techs.add("WordPress");

  return Array.from(techs).slice(0, 30);
}

// ─── content summary ─────────────────────────────────────────────────────────────

function extractContentSummary(doc) {
  if (!doc || doc._fallback) return "";
  const paragraphs = queryAll(doc, "p")
    .map(p => p.textContent?.trim() || "")
    .filter(t => t.length > 60);
  if (paragraphs.length) {
    paragraphs.sort((a, b) => b.length - a.length);
    return paragraphs[0].slice(0, 500);
  }
  const article = queryOne(doc, "article");
  if (article) {
    const txt = article.textContent?.trim();
    if (txt) return txt.slice(0, 500);
  }
  return "";
}

// ─── public API ────────────────────────────────────────────────────────────────────

export async function scrapeWebsite(url) {
  if (!_JSDOM) await loadJSDOM();

  let meta = null;
  try {
    meta = await microlinkMetadata(url);
  } catch {}

  let domResult = {};
  try {
    const html = await fetchHtml(url);
    domResult = extractFromHtml(html, url);
  } catch {}

  const merged = {
    title:           domResult.title           || meta?.title       || "",
    description:     domResult.description     || meta?.description || "",
    image:           domResult.image           || meta?.image       || "",
    favicon:         domResult.favicon         || meta?.favicon     || "",
    social_links:    domResult.social_links    || [],
    contacts:        domResult.contacts        || [],
    technologies:    domResult.technologies    || [],
    content_summary: domResult.content_summary || "",
  };

  if (meta?.author && !merged.contacts.some(c => c.value === meta.author)) {
    merged.contacts.push({ type: "general", value: meta.author });
  }

  return merged;
}
