/**
 * Structured error helpers for workflow endpoints.
 *
 * Every endpoint error response follows:
 *   { success: false, error: { code: string, message: string, details?: any } }
 *
 * Codes are workflow-action scoped (e.g. LEAD-001, WEBAUDIT-001).
 */

/** Build a standardized error JSON response. */
export function error(code, message, details) {
  const body = { success: false, error: { code, message } };
  if (details != null) body.error.details = details;
  return body;
}

/** Map a list of validation strings into a 400 error body. */
export function validationError(errors) {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: errors,
    },
  };
}

/** Map upstream failures to a 502-style body. */
export function upstreamError(service, message) {
  return {
    success: false,
    error: {
      code: "UPSTREAM_ERROR",
      message: `${service} unavailable or returned an error`,
      details: message,
    },
  };
}

/** Map a timeout. */
export function timeoutError(workflow) {
  return {
    success: false,
    error: {
      code: "WORKFLOW_TIMEOUT",
      message: `The ${workflow} workflow exceeded the time limit and was cancelled`,
    },
  };
}

/** Map an unsupported-request error. */
export function unsupportedError(workflow, reason) {
  return {
    success: false,
    error: {
      code: "UNSUPPORTED",
      message: reason || `This request is not supported by the ${workflow} workflow`,
    },
  };
}
