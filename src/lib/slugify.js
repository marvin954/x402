/**
 * Generate a URL-safe slug from a name
 * Ensures uniqueness by appending a short random suffix if needed
 */
import { endpoints } from "../db/queries.js";

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function uniqueSlug(name, providedSlug) {
  const base = slugify(providedSlug || name);
  if (!base) throw new Error("Cannot derive slug from name");

  // Try the clean slug first
  if (!(await endpoints.slugExists(base))) return base;

  // Append random suffix until unique
  for (let i = 0; i < 10; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await endpoints.slugExists(candidate))) return candidate;
  }

  throw new Error("Could not generate a unique slug — try a different name");
}

/**
 * Validate a user-provided slug
 */
export function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{1,50}[a-z0-9]$/.test(slug);
}
