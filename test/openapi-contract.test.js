import test from "node:test";
import assert from "node:assert/strict";
import { endpointContract, validateEndpointContract } from "../src/lib/openapi-contract.js";

test("built-in demo contracts provide precise success schemas", () => {
  assert.equal(endpointContract({ slug: "inspirational-quote" }).responseSchema.type, "array");
  assert.equal(endpointContract({ slug: "random-meme" }).responseSchema.properties.url.format, "uri");
  assert.deepEqual(endpointContract({ slug: "random-joke" }).responseSchema.properties.type.enum, ["single", "twopart"]);
});

test("query parameters must explicitly declare required", () => {
  assert.throws(
    () => validateEndpointContract({ queryParameters: [{ name: "city", in: "query", schema: { type: "string" } }] }),
    /must declare required/
  );
  assert.deepEqual(
    validateEndpointContract({ queryParameters: [{ name: "city", in: "query", required: true, schema: { type: "string" } }] }).queryParameters,
    [{ name: "city", in: "query", required: true, schema: { type: "string" } }]
  );
});
