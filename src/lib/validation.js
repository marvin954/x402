/**
 * Lightweight validation helpers for workflow endpoints.
 *
 * Conventions:
 *  - validateXxx(req.body) → { valid: true } or { valid: false, errors: string[] }
 *  - Errors are plain strings (route maps to 400).
 *  - No thrown exceptions from validation — always return-shaped.
 */

// ─── primitives ─────────────────────────────────────────────────────────────────

export function validateRequired(body, keys) {
  const errors = [];
  for (const k of keys) {
    if (body == null || body[k] == null || body[k] === "") {
      errors.push(`"${k}" is required`);
    }
  }
  return errors;
}

export function validateString(body, key, opts = {}) {
  const v = body?.[key];
  if (v == null) return [];
  if (typeof v !== "string") return [`"${key}" must be a string`];
  const errs = [];
  if (opts.minLength && v.length < opts.minLength) errs.push(`"${key}" must be at least ${opts.minLength} characters`);
  if (opts.maxLength && v.length > opts.maxLength) errs.push(`"${key}" must be at most ${opts.maxLength} characters`);
  if (opts.pattern && !opts.pattern.test(v)) errs.push(`"${key}" has invalid format`);
  if (opts.enum && !opts.enum.includes(v)) errs.push(`"${key}" must be one of: ${opts.enum.join(", ")}`);
  return errs;
}

export function validateInteger(body, key, opts = {}) {
  const v = body?.[key];
  if (v == null) return [];
  if (typeof v !== "number" || !Number.isInteger(v)) return [`"${key}" must be an integer`];
  const errs = [];
  if (opts.min !== undefined && v < opts.min) errs.push(`"${key}" must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) errs.push(`"${key}" must be <= ${opts.max}`);
  return errs;
}

export function validateNumber(body, key, opts = {}) {
  const v = body?.[key];
  if (v == null) return [];
  if (typeof v !== "number" || isNaN(v)) return [`"${key}" must be a number`];
  const errs = [];
  if (opts.min !== undefined && v < opts.min) errs.push(`"${key}" must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) errs.push(`"${key}" must be <= ${opts.max}`);
  return errs;
}

export function validateArray(body, key, opts = {}) {
  const v = body?.[key];
  if (v == null) return [];
  if (!Array.isArray(v)) return [`"${key}" must be an array`];
  const errs = [];
  if (opts.minLength !== undefined && v.length < opts.minLength) errs.push(`"${key}" must have at least ${opts.minLength} items`);
  if (opts.maxLength !== undefined && v.length > opts.maxLength) errs.push(`"${key}" must have at most ${opts.maxLength} items`);
  if (opts.itemType === "string") {
    for (let i = 0; i < v.length; i++) {
      if (typeof v[i] !== "string") errs.push(`"${key}"[${i}] must be a string`);
    }
  }
  if (opts.unique && new Set(v).size !== v.length) errs.push(`"${key}" must not contain duplicates`);
  return errs;
}

export function validateUrl(body, key) {
  const v = body?.[key];
  if (v == null) return [];
  if (typeof v !== "string") return [`"${key}" must be a string`];
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol)) return [`"${key}" must be http/https`];
  } catch {
    return [`"${key}" is not a valid URL`];
  }
  return [];
}

export function validateFile(body, key, opts = {}) {
  const v = body?.[key];
  if (v == null) return [];
  const errs = [];
  if (Buffer.isBuffer(v)) {
    if (opts.maxSize && v.length > opts.maxSize) errs.push(`"${key}" exceeds ${opts.maxSize} bytes`);
    return errs;
  }
  if (typeof v === "string" && v.startsWith("data:")) {
    // parse header
    const comma = v.indexOf(",");
    if (comma < 0) return [`"${key}" is not a valid data URI`];
    const header = v.slice(0, comma);
    const mime = header.split(";").find((s) => s.startsWith("data:")).slice(5);
    if (opts.mimeTypes && !opts.mimeTypes.some((m) => mime.startsWith(m))) {
      errs.push(`"${key}" must be one of: ${opts.mimeTypes.join(", ")}`);
    }
    // estimate size from base64
    const b64 = v.slice(comma + 1);
    const bytes = Math.ceil((b64.length * 3) / 4);
    if (opts.maxSize && bytes > opts.maxSize) errs.push(`"${key}" exceeds ${opts.maxSize} bytes`);
    return errs;
  }
  return [`"${key}" must be a Buffer or data URI string`];
}

// ─── composable validator ────────────────────────────────────────────────────────

export function validateDocumentFile(body) {
  const v = body?.file;
  if (v == null) {
    // Also accept text input via document_text or text field
    const text = body?.document_text || body?.text || "";
    if (typeof text === "string" && text.trim().length >= 10) return true;
    return false;
  }
  if (Buffer.isBuffer(v)) return v.length <= 10_000_000;
  if (typeof v === "string" && v.startsWith("data:")) {
    const comma = v.indexOf(",");
    if (comma < 0) return false;
    const b64 = v.slice(comma + 1);
    const bytes = Math.ceil((b64.length * 3) / 4);
    return bytes <= 10_000_000;
  }
  return false;
}

export function validateContractFile(body) {
  const v = body?.file;
  if (v == null) {
    // Also accept text input via contract_text or text field
    const text = body?.contract_text || body?.text || "";
    if (typeof text === "string" && text.trim().length >= 10) return true;
    return false;
  }
  return validateDocumentFile(body);
}

/** Industry must be a non-empty string. */
export function validateIndustry(value) {
  return value != null && typeof value === "string" && value.trim().length >= 1;
}

/** Location must be a non-empty string. */
export function validateLocation(value) {
  return value != null && typeof value === "string" && value.trim().length >= 1;
}

/** Returns true if value is a positive integer >= min, <= max (or unbounded if max is null). */
export function validatePositiveInt(value, min = 1, max = null) {
  if (value == null || typeof value !== "number" || !Number.isInteger(value) || value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/** Returns true if `value` is a positive integer or null. */
export function validatePositiveIntOrNull(value, min = 1, max = null) {
  return value == null || validatePositiveInt(value, min, max);
}

/** Depth must be one of the allowed values. */
export function validateDepth(value, allowed = ["basic", "standard", "deep", "enterprise"]) {
  return value == null || (typeof value === "string" && allowed.includes(value));
}

/** Package must be one of: small, medium, large. */
export function validatePackage(value) {
  return value == null || (typeof value === "string" && ["small", "medium", "large"].includes(value));
}

/** Purpose must be a valid email purpose string. */
export function validatePurpose(value) {
  return value == null || (typeof value === "string" && ["cold_outreach", "follow_up", "sales_sequence", "partnership", "customer_response", "networking", "thank_you", "breakup_email"].includes(value));
}

/** Count for new pairs: positive int 1-50. */
export function validateNewPairsCount(value) {
  return validatePositiveInt(value, 1, 50);
}

/** Validate that `value` is one of the allowed values. */
export function validateEnum(value, allowed, opts = {}) {
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(value);
}

/** Validate that `value` is within [min, max] inclusive. */
export function validateRange(value, min, max) {
  if (typeof value !== "number" || isNaN(value)) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** Validate that `value` is a non-empty string (after trimming). */
export function validateNonEmptyString(value, opts = {}) {
  if (typeof value !== "string") return false;
  return value.trim().length >= (opts.minLength ?? 1);
}
export function collect(...validators) {
  const out = [];
  for (const v of validators) {
    const r = v();
    if (Array.isArray(r)) out.push(...r);
  }
  return out;
}

/** Shape: { valid, errors } */
export function validate(body, validators) {
  const errors = validators.map((v) => v()).flat().filter(Boolean);
  return { valid: errors.length === 0, errors };
}
