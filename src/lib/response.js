/**
 * Standardized success response wrapper for workflow endpoints.
 *
 * Every workflow returns:
 *   { success: true, data: <workflow-specific>, metadata?: { ... } }
 */
export function success(data, metadata) {
  const body = { success: true, data };
  if (metadata) body.metadata = metadata;
  return body;
}

/** Attach standard timing + request metadata to a workflow result. */
export function withMeta(result, req, extra = {}) {
  return {
    ...result,
    metadata: {
      requestId: req?.requestId || undefined,
      completedAt: new Date().toISOString(),
      ...extra,
    },
  };
}

/** Wrap an async workflow function call with standard metadata.
 *  Catches errors and returns a consistent { success, data?, error?, metadata } shape.
 */
export async function _meta(req, slug, fn) {
  const start = Date.now();
  try {
    const data = await fn();
    return {
      success: true,
      data,
      metadata: {
        slug,
        completedAt: new Date().toISOString(),
        duration_ms: Date.now() - start,
        ...(req?.requestId ? { requestId: req.requestId } : {}),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message || "Workflow execution failed",
        ...(err.details ? { details: err.details } : {}),
      },
      metadata: {
        slug,
        completedAt: new Date().toISOString(),
        duration_ms: Date.now() - start,
        ...(req?.requestId ? { requestId: req.requestId } : {}),
      },
    };
  }
}

/** Build a standardized error response object. */
export function errorResponse(err, defaultStatus = 500) {
  if (!err || typeof err !== "object") {
    return { success: false, error: { code: "INTERNAL_ERROR", message: String(err || "Unknown error") } };
  }
  const code = err.code || "INTERNAL_ERROR";
  const message = err.message || "An error occurred";
  const body = { success: false, error: { code, message } };
  if (err.details) body.error.details = err.details;
  if (err.status) body.error.status = err.status;
  return body;
}
