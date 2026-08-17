/**
 * Upstream proxy service
 *
 * After payment is verified, this forwards the request to the provider's
 * upstream URL and streams the response back to the client.
 */
import https from "https";
import http from "http";

const TIMEOUT_MS     = parseInt(process.env.PROXY_TIMEOUT_MS || "15000", 10);
const MAX_BODY_BYTES = parseInt(process.env.MAX_PROXY_BODY   || "10485760", 10);

// Headers we strip before forwarding (hop-by-hop + x402 specific)
const STRIP_REQUEST_HEADERS = new Set([
  "host", "x-payment", "x-api-key", "x-forwarded-for",
  "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
  "connection", "keep-alive", "transfer-encoding", "te",
  "trailers", "upgrade", "proxy-authorization", "proxy-authenticate",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding", "connection", "keep-alive",
  "proxy-authenticate", "trailer", "upgrade",
]);

/**
 * Forward request to the provider's upstream URL.
 *
 * @param {object} options
 * @param {string}  options.upstreamUrl         - Provider's real API URL
 * @param {string}  options.method              - HTTP method
 * @param {object}  options.incomingHeaders     - Headers from the marketplace client
 * @param {object}  options.query               - Query params (forwarded)
 * @param {Buffer|null} options.body            - Request body
 * @param {string|null} options.upstreamAuthHeader - Optional encrypted auth header
 *
 * @returns {{ status: number, headers: object, body: Buffer, timeMs: number }}
 */
export async function proxyRequest({
  upstreamUrl,
  method,
  incomingHeaders,
  query,
  body,
  upstreamAuthHeader,
}) {
  const start = Date.now();

  // Build the target URL (pass through query params from original request)
  const target = new URL(upstreamUrl);
  for (const [k, v] of Object.entries(query || {})) {
    // Skip our own control params
    if (k === "api_key" || k === "admin_key") continue;
    target.searchParams.set(k, v);
  }

  // Build forwarded headers
  const forwardHeaders = {};
  for (const [k, v] of Object.entries(incomingHeaders || {})) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) {
      forwardHeaders[k] = v;
    }
  }

  // Inject provider's upstream auth if configured
  if (upstreamAuthHeader) {
    forwardHeaders["authorization"] = upstreamAuthHeader;
  }

  forwardHeaders["host"] = target.hostname;
  forwardHeaders["x-forwarded-by"] = "mammba-x402-marketplace";

  return new Promise((resolve, reject) => {
    const lib = target.protocol === "https:" ? https : http;
    const options = {
      hostname: target.hostname,
      port:     target.port || (target.protocol === "https:" ? 443 : 80),
      path:     target.pathname + target.search,
      method:   method.toUpperCase(),
      headers:  forwardHeaders,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      let size = 0;

      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new Error(`Upstream response exceeded ${MAX_BODY_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);

        // Filter response headers
        const responseHeaders = {};
        for (const [k, v] of Object.entries(res.headers || {})) {
          if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) {
            responseHeaders[k] = v;
          }
        }

        resolve({
          status:  res.statusCode || 200,
          headers: responseHeaders,
          body:    responseBody,
          timeMs:  Date.now() - start,
        });
      });

      res.on("error", reject);
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Upstream timeout after ${TIMEOUT_MS}ms`));
    });

    req.on("error", (err) => {
      reject(new Error(`Upstream error: ${err.message}`));
    });

    if (body && body.length > 0) {
      req.write(body);
    }

    req.end();
  });
}
