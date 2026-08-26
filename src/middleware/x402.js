/**
 * x402 Payment Middleware
 *
 * Handles the full x402 v2 flow:
 *   1. No X-Payment header  → 402 with payment requirements
 *   2. X-Payment present    → verify with facilitator → settle → attach to req
 */
import https from "https";
import http from "http";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.xyz/facilitator";
const NETWORK         = process.env.NETWORK          || "eip155:84532";
const USDC_ASSET      = process.env.USDC_ASSET        || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SERVER_URL      = (process.env.SERVER_URL || "http://localhost:3000").replace(/\/+$/, "");
const MAX_TIMEOUT_SEC = parseInt(process.env.MAX_TIMEOUT_SECONDS || "60", 10);
const IS_DEV          = process.env.NODE_ENV !== "production";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPaymentRequired(slug, name, description, priceAtomic) {
  return {
    x402Version: 2,
    error: "Payment required to access this resource",
    resource: {
      url: `${SERVER_URL}/proxy/${slug}`,
      description: description || `${name} — MAMMBA x402 Marketplace`,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        amount: String(priceAtomic),
        asset: USDC_ASSET,
        payTo: process.env.PLATFORM_WALLET,
        maxTimeoutSeconds: MAX_TIMEOUT_SEC,
        extra: { name: "USDC", version: "2" },
      },
    ],
    extensions: {
      marketplace: {
        info: {
          platform: "MAMMBA x402 Marketplace",
          endpointSlug: slug,
          providerName: "See /marketplace/endpoints for details",
        },
        schema: {
          type: "object",
          properties: {
            platform: { type: "string" },
            endpointSlug: { type: "string" },
          },
        },
      },
    },
  };
}

function respondPaymentRequired(res, requirements) {
  res.setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(requirements)).toString("base64"));
  return res.status(402).json(requirements);
}

function parsePaymentHeader(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    try { return JSON.parse(raw); } catch { return null; }
  }
}

function facilitatorPost(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const url = new URL(`${FACILITATOR_URL}${path}`);
    const lib = url.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: false, error: "Bad facilitator JSON" }); }
        });
      }
    );

    req.on("error", (e) => {
      if (IS_DEV) {
        // Dev bypass — return mock settlement
        console.warn("[x402] DEV: bypassing facilitator →", path);
        if (path === "/verify") {
          resolve({ ok: true, data: { isValid: true, payer: "0xDEV_PAYER" } });
        } else {
          resolve({
            ok: true,
            data: {
              success: true,
              transaction: "0xDEV_" + Math.random().toString(16).slice(2, 18),
              network: NETWORK,
              payer: "0xDEV_PAYER",
            },
          });
        }
      } else {
        resolve({ ok: false, error: e.message });
      }
    });

    req.setTimeout(10_000, () => {
      req.destroy();
      if (IS_DEV) {
        resolve({ ok: true, data: path === "/verify"
          ? { isValid: true, payer: "0xDEV_PAYER" }
          : { success: true, transaction: "0xDEV_TIMEOUT", network: NETWORK, payer: "0xDEV_PAYER" }
        });
      } else {
        resolve({ ok: false, error: "Facilitator timeout" });
      }
    });

    req.write(payload);
    req.end();
  });
}

// ─── Main Middleware Factory ──────────────────────────────────────────────────

/**
 * Returns an Express middleware that enforces x402 payment for the given endpoint.
 *
 * @param {object} endpoint  - row from `endpoints` table (slug, name, price_atomic, etc.)
 */
export function requirePayment(endpoint) {
  const requirements = {
    scheme: "exact",
    network: NETWORK,
    amount: String(endpoint.price_atomic),
    asset: USDC_ASSET,
    payTo: process.env.PLATFORM_WALLET,
    maxTimeoutSeconds: MAX_TIMEOUT_SEC,
    extra: { name: "USDC", version: "2" },
  };

  return async (req, res, next) => {
    const rawHeader = req.headers["x-payment"];

    // ── Step 1: No header → return 402 ───────────────────────────────────────
    if (!rawHeader) {
      return respondPaymentRequired(
        res,
        buildPaymentRequired(endpoint.slug, endpoint.name, endpoint.description, endpoint.price_atomic)
      );
    }

    // ── Step 2: Parse ─────────────────────────────────────────────────────────
    const paymentPayload = parsePaymentHeader(rawHeader);
    if (!paymentPayload) {
      return respondPaymentRequired(res, {
        ...buildPaymentRequired(endpoint.slug, endpoint.name, endpoint.description, endpoint.price_atomic),
        error: "Malformed X-Payment header — expected base64-encoded JSON",
      });
    }

    // ── Step 3: Verify ────────────────────────────────────────────────────────
    const verification = await facilitatorPost("/verify", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements: requirements,
    });

    if (!verification.ok || !verification.data?.isValid) {
      return respondPaymentRequired(res, {
        ...buildPaymentRequired(endpoint.slug, endpoint.name, endpoint.description, endpoint.price_atomic),
        error: verification.data?.invalidReason || verification.error || "Payment verification failed",
      });
    }

    // ── Step 4: Settle ────────────────────────────────────────────────────────
    const settlement = await facilitatorPost("/settle", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements: requirements,
    });

    if (!settlement.ok || !settlement.data?.success) {
      return respondPaymentRequired(res, {
        ...buildPaymentRequired(endpoint.slug, endpoint.name, endpoint.description, endpoint.price_atomic),
        error: settlement.data?.errorReason || "Payment settlement failed",
      });
    }

    // ── Step 5: Compute revenue split ─────────────────────────────────────────
    const feePct = parseFloat(process.env.PLATFORM_FEE_PERCENT || "15");
    const grossUsdc = endpoint.price_atomic / 1_000_000;
    const platformCut = parseFloat((grossUsdc * (feePct / 100)).toFixed(6));
    const providerCut = parseFloat((grossUsdc - platformCut).toFixed(6));

    // ── Attach to request for downstream use ──────────────────────────────────
    req.x402 = {
      payer:        settlement.data.payer || verification.data.payer || "unknown",
      transaction:  settlement.data.transaction,
      network:      settlement.data.network || NETWORK,
      amountAtomic: endpoint.price_atomic,
      feePct,
      platformCut,
      providerCut,
    };

    // Return the x402 v2 settlement receipt and keep the legacy header for compatibility.
    const paymentResponse = Buffer.from(JSON.stringify(settlement.data)).toString("base64");
    res.setHeader("PAYMENT-RESPONSE", paymentResponse);
    res.setHeader("X-Payment-Response", paymentResponse);

    next();
  };
}

export { buildPaymentRequired };
