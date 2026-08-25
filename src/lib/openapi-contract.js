const GENERIC_JSON_OBJECT = { type: "object", additionalProperties: true };

// Contracts for marketplace-managed demos. Provider contracts stored in the database take precedence.
const BUILT_IN_RESPONSE_SCHEMAS = {
  "inspirational-quote": {
    type: "array",
    items: {
      type: "object",
      required: ["q", "a"],
      properties: {
        q: { type: "string", description: "Quote text" },
        a: { type: "string", description: "Author" },
        h: { type: "string", description: "HTML-formatted quote" },
      },
    },
  },
  "random-meme": {
    type: "object",
    required: ["title", "url"],
    properties: {
      title: { type: "string" },
      url: { type: "string", format: "uri" },
      postLink: { type: "string", format: "uri" },
      subreddit: { type: "string" },
      author: { type: "string" },
      nsfw: { type: "boolean" },
      spoiler: { type: "boolean" },
    },
  },
  "random-joke": {
    type: "object",
    required: ["error", "category", "type", "id", "safe", "lang"],
    properties: {
      error: { type: "boolean" },
      category: { type: "string" },
      type: { type: "string", enum: ["single", "twopart"] },
      joke: { type: "string", description: "Present when type is single" },
      setup: { type: "string", description: "Present when type is twopart" },
      delivery: { type: "string", description: "Present when type is twopart" },
      id: { type: "integer" },
      safe: { type: "boolean" },
      lang: { type: "string" },
    },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateJsonSchema(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new Error(`${fieldName} must be an OpenAPI schema object`);
  if (value.type !== undefined && typeof value.type !== "string" && !Array.isArray(value.type)) {
    throw new Error(`${fieldName}.type must be a string or array`);
  }
  return value;
}

export function validateEndpointContract({ queryParameters, requestBodySchema, responseSchema }) {
  if (queryParameters !== undefined) {
    if (!Array.isArray(queryParameters)) throw new Error("queryParameters must be an array");
    for (const parameter of queryParameters) {
      if (!isPlainObject(parameter) || typeof parameter.name !== "string" || !parameter.name) {
        throw new Error("Each queryParameters entry must have a non-empty name");
      }
      if (parameter.in !== "query") throw new Error("Endpoint parameters must use in: 'query'");
      if (typeof parameter.required !== "boolean") {
        throw new Error(`query parameter '${parameter.name}' must declare required: true or false`);
      }
      validateJsonSchema(parameter.schema, `query parameter '${parameter.name}' schema`);
    }
  }

  return {
    queryParameters: queryParameters ?? [],
    requestBodySchema: validateJsonSchema(requestBodySchema, "requestBodySchema"),
    responseSchema: validateJsonSchema(responseSchema, "responseSchema"),
  };
}

export function endpointContract(endpoint) {
  return {
    queryParameters: endpoint.query_parameters || [],
    requestBodySchema: endpoint.request_body_schema || { type: "object" },
    responseSchema: endpoint.response_schema || BUILT_IN_RESPONSE_SCHEMAS[endpoint.slug] || GENERIC_JSON_OBJECT,
  };
}
