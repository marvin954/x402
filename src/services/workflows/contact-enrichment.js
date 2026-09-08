
/**
 * Contact Enrichment Workflow — POST /api/workflows/contact-enrichment
 *
 * Enriches a company with publicly available information: description,
 * industry, services, location, and public business contact info.
 */
import { webSearch, scrape } from "../../lib/workflow-utils.js";
import { chatJson } from "../../lib/workflow-utils.js";
import { success, withMeta } from "../../lib/response.js";

export async function contactEnrichment(input, req) {
  const { company_name, website, contact_info, enrich = true } = input;
  const email = contact_info?.email || (typeof contact_info === "string" ? null : null);
  const company = company_name || (contact_info?.company || contact_info?.name || website ? (new URL(website).hostname.replace(/^www\./, "")) : null);
  const siteUrl = website || contact_info?.website;

  if (!company && !siteUrl && !email) {
    return { success: false, error: { code: "VALIDATION_ERROR", message: 'Either "company_name", "website", or "contact_info" with email is required' } };
  }

  const results = [];
  let primarySource = null;

  // 1. If website provided, scrape it first
  if (website) {
    try {
      const info = await scrape(website);
      primarySource = { type: "website_scrape", url: website, data: info };
      results.push({
        type: "website",
        name: info.title || company_name || "(company)",
        url: website,
        description: info.description || "",
        favicon: info.favicon || "",
        image: info.image || "",
        technologies: info.technologies || [],
        contacts: info.contacts || [],
        social_links: info.social_links || [],
      });
    } catch (err) {
      console.error("[contact-enrichment] scrape error:", err.message);
    }
  }

  // 2. Web search for the company
  const searchQuery = company_name || new URL(website).hostname.replace(/^www\./, "");
  const searchResults = await webSearch(searchQuery, { maxResults: 10 });

  // 3. Extract company info from search results
  const searchInfo = extractSearchCompanyInfo(searchResults, company_name);
  if (searchInfo && (!results.length || results[0].name !== searchInfo.name)) {
    results.push(searchInfo);
  }

  // 4. Try to find additional company profiles (LinkedIn, Crunchbase, etc.)
  const profileResults = await findCompanyProfiles(searchQuery);
  results.push(...profileResults);

  // 5. Consolidate into final response
  const enriched = consolidateEnrichment(results, company_name);

  return {
    success: true,
    data: enriched,
    metadata: { completedAt: new Date().toISOString() },
  };
}

function extractSearchCompanyInfo(results, companyName) {
  // Try to find the most relevant result that looks like the company's own site
  const companyUrls = results
    .filter(r => r.url && !r.url.includes("google.") && !r.url.includes("bing.") && !r.url.includes("duckduckgo"))
    .slice(0, 3);

  if (companyUrls.length === 0) return null;

  const top = companyUrls[0];
  return {
    type: "search_result",
    name: top.title ? extractCompanyTitle(top.title, companyName) : companyName || "(company)",
    url: top.url,
    description: top.snippet || "",
    source: "web_search",
  };
}

function extractCompanyTitle(title, companyName) {
  if (!title) return companyName || "(company)";
  let clean = title
    .replace(/\b(?:best|top|rated|near me|find|search|results|list|guide|review|reviews|compare|vs|versus|hire|price|cost|how to|what is|about|the|official|service|services|solutions|inc|llc|co|company|business|provider|contractor|experts|pros|specialists|professionals|agency)\b/gi, "")
    .replace(/[-–—|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 2 ? clean : (companyName || title.slice(0, 60));
}

async function findCompanyProfiles(query) {
  // Search for common business profile platforms
  const profiles = [];
  const searches = [
    { q: `${query} LinkedIn`, platform: "linkedin" },
    { q: `${query} company profile`, platform: "general" },
  ];
  for (const s of searches) {
    try {
      const results = await webSearch(s.q, { maxResults: 5 });
      for (const r of results) {
        if (r.url && (r.url.includes("linkedin.com") || r.url.includes("company"))) {
          profiles.push({
            type: "profile",
            platform: s.platform,
            name: extractCompanyTitle(r.title, query),
            url: r.url,
            description: r.snippet || "",
          });
          if (profiles.length >= 3) break;
        }
      }
    } catch (err) {
      console.error("[contact-enrichment] profile search error:", err.message);
    }
  }
  return profiles;
}

function consolidateEnrichment(results, companyName) {
  // Use the first result as the primary
  const primary = results[0] || {};
  const name = primary.name || companyName || "(company)";

  const website = primary.url || "";
  const description = [
    primary.description,
    primary.snippet,
  ].filter(Boolean).join(" ").trim() || "";

  const technologies = primary.technologies || [];
  const contacts = primary.contacts || [];
  const social_links = primary.social_links || [];

  // Collect additional info from other results
  const additionalDescriptions = results
    .slice(1)
    .map(r => r.description || r.snippet || "")
    .filter(Boolean);

  const allProfiles = results
    .filter(r => r.type === "profile" || r.type === "search_result")
    .map(r => ({ platform: r.platform || "web", url: r.url, name: r.name }));

  return {
    company_name: name,
    website: website,
    description: description || `Information about ${name}`,
    industry: inferIndustry(description, name),
    services: inferServices(description),
    location: inferLocation(description),
    public_contacts: contacts.filter(c => c.type === "email" || c.type === "phone").slice(0, 5),
    social_profiles: social_links.slice(0, 10).map(s => ({ platform: s.platform, url: s.url })),
    additional_profiles: allProfiles.slice(1),
    sources: results.map(r => ({ type: r.type, url: r.url || "" })),
    enrichment_date: new Date().toISOString(),
    note: "Information derived from publicly available sources. Missing fields indicate no public data was found.",
  };
}

function inferIndustry(description, name) {
  const desc = (description || "").toLowerCase();
  const nameLower = (name || "").toLowerCase();
  if (desc.includes("restaurant") || desc.includes("food") || desc.includes("dining") || nameLower.includes("cafe") || nameLower.includes("restaurant")) return "Food & Dining";
  if (desc.includes("real estate") || desc.includes("property") || desc.includes("home") || nameLower.includes("realty")) return "Real Estate";
  if (desc.includes("construction") || desc.includes("contractor") || desc.includes("general") || nameLower.includes("construction")) return "Construction";
  if (desc.includes("technology") || desc.includes("software") || desc.includes("tech") || nameLower.includes("tech") || nameLower.includes("soft")) return "Technology";
  if (desc.includes("health") || desc.includes("medical") || desc.includes("dental") || desc.includes("clinic") || nameLower.includes("health") || nameLower.includes("med")) return "Healthcare";
  if (desc.includes("marketing") || desc.includes("advertising") || desc.includes("media") || nameLower.includes("marketing")) return "Marketing & Advertising";
  if (desc.includes("law") || desc.includes("legal") || desc.includes("attorney") || nameLower.includes("law") || nameLower.includes("legal")) return "Legal Services";
  if (desc.includes("finance") || desc.includes("accounting") || desc.includes("financial") || nameLower.includes("finance") || nameLower.includes("accounting")) return "Financial Services";
  if (desc.includes("retail") || desc.includes("store") || desc.includes("shop") || nameLower.includes("store") || nameLower.includes("shop")) return "Retail";
  if (desc.includes("education") || desc.includes("school") || desc.includes("learning") || nameLower.includes("academy")) return "Education";
  if (desc.includes("hospitality") || desc.includes("hotel") || desc.includes("inn") || nameLower.includes("hotel")) return "Hospitality";
  return "Professional Services";
}

function inferServices(description) {
  const desc = (description || "").toLowerCase();
  const services = [];
  if (desc.includes("consult")) services.push("Consulting");
  if (desc.includes("design")) services.push("Design Services");
  if (desc.includes("development") || desc.includes("build")) services.push("Development/Building");
  if (desc.includes("marketing") || desc.includes("advertising")) services.push("Marketing & Advertising");
  if (desc.includes("sales")) services.push("Sales");
  if (desc.includes("support") || desc.includes("service")) services.push("Customer Service");
  if (desc.includes("management")) services.push("Management");
  if (desc.includes("training")) services.push("Training");
  if (services.length === 0) services.push("General Business Services");
  return services.slice(0, 8);
}

function inferLocation(description) {
  // Look for location patterns
  const locRe = /(?:in|based in|located in|serving|area|serving the|metro|region)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/;
  const match = locRe.exec(description);
  if (match) return match[1].trim();
  // Look for city, state patterns
  const cityState = /([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*),\s*([A-Z]{2})/;
  const csMatch = cityState.exec(description);
  if (csMatch) return `${csMatch[1]}, ${csMatch[2]}`;
  return "";
}
