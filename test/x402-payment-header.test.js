import test from "node:test";
import assert from "node:assert/strict";
import { requirePayment } from "../src/middleware/x402.js";

test("an unpaid request returns an x402 v2 PAYMENT-REQUIRED header", async () => {
  const headers = {};
  let statusCode;
  let body;
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  const endpoint = {
    slug: "inspirational-quote",
    name: "Inspirational Quote",
    description: "Returns an inspirational quote.",
    price_atomic: 5000,
  };

  await requirePayment(endpoint)({ headers: {} }, res, () => assert.fail("next must not run"));

  assert.equal(statusCode, 402);
  assert.equal(body.x402Version, 2);
  assert.ok(headers["payment-required"]);
  const paymentRequired = JSON.parse(Buffer.from(headers["payment-required"], "base64").toString("utf8"));
  assert.equal(paymentRequired.x402Version, 2);
  assert.equal(paymentRequired.resource.url, body.resource.url);
  assert.equal(paymentRequired.accepts[0].amount, "5000");
});
