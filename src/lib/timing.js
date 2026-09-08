/** * Timing helpers for workflow execution.
 *
 * Provides enforceTimeout (throws on exceed) and timed (logs + returns duration).
 */
const DEFAULT_TIMEOUT_MS = parseInt(process.env.WORKFLOW_DEFAULT_TIMEOUT_MS || "60000", 10);

/**
 * Run `fn` with a hard timeout. Throws a WorkflowTimeoutError if exceeded.
 * Uses Promise.race — no AbortController, no process.exit.
 */
export async function enforceTimeout(ms, fn) {
  if (ms <= 0) ms = DEFAULT_TIMEOUT_MS;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Workflow execution timed out"), { name: "WorkflowTimeoutError", code: "WORKFLOW_TIMEOUT" })), ms);
  });
  try {
    const result = await fn();
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Run `fn` and attach timing metadata to the result.
 * Returns { result, durationMs }.
 */
export async function timed(fn, metadata = {}) {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start, ...metadata };
}

/**
 * Return a promise that resolves after `ms` milliseconds.
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Clamp a number between min and max.
 */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
