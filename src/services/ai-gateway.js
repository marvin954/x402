/**
 * AI Gateway Service
 *
 * Unified gateway that routes AI requests to multiple backend providers
 * (OpenAI, Anthropic, Google AI, Ollama, etc.) through one consistent API.
 *
 * Endpoints:
 *   POST /v1/chat           — chat completions (text in, text out)
 *   POST /v1/embeddings     — text embeddings (text in, vector out)
 *   POST /v1/image          — image generation (prompt in, image URL out)
 *   POST /v1/transcribe     — audio transcription (audio in, text out)
 *
 * Each endpoint is a paid marketplace service ($0.01–$0.50 per call depending
 * on the model/provider). Providers configure their preferred backend via env vars.
 *
 * Env vars:
 *   AI_GATEWAY_DEFAULT_MODEL       — default model for chat (default: gpt-4o-mini)
 *   AI_GATEWAY_CHAT_PROVIDER       — chat provider: openai | anthropic | ollama | mock (default: mock)
 *   AI_GATEWAY_EMBED_PROVIDER      — embeddings provider: openai | ollama | mock (default: mock)
 *   AI_GATEWAY_IMAGE_PROVIDER      — image provider: openai | mock (default: mock)
 *   AI_GATEWAY_TRANSCRIBE_PROVIDER — transcribe provider: openai | mock (default: mock)
 *   OPENAI_API_KEY                 — OpenAI API key (for chat, embeddings, image, transcribe)
 *   ANTHROPIC_API_KEY              — Anthropic API key (for chat)
 *   OLLAMA_URL                     — Ollama base URL (for chat, embeddings)
 *   AI_GATEWAY_MAX_TOKENS          — max tokens for chat responses (default: 2048)
 */

// ─── config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  chat: {
    provider: process.env.AI_GATEWAY_CHAT_PROVIDER || "mock",
    defaultModel: process.env.AI_GATEWAY_DEFAULT_MODEL || "gpt-4o-mini",
    maxTokens: parseInt(process.env.AI_GATEWAY_MAX_TOKENS || "2048", 10),
    temperature: parseFloat(process.env.AI_GATEWAY_TEMPERATURE || "0.7"),
  },
  embed: {
    provider: process.env.AI_GATEWAY_EMBED_PROVIDER || "mock",
    defaultModel: process.env.AI_GATEWAY_EMBED_MODEL || "text-embedding-3-small",
  },
  image: {
    provider: process.env.AI_GATEWAY_IMAGE_PROVIDER || "mock",
    defaultModel: process.env.AI_GATEWAY_IMAGE_MODEL || "dall-e-3",
    size: process.env.AI_GATEWAY_IMAGE_SIZE || "1024x1024",
  },
  transcribe: {
    provider: process.env.AI_GATEWAY_TRANSCRIBE_PROVIDER || "mock",
    defaultModel: process.env.AI_GATEWAY_TRANSCRIBE_MODEL || "whisper-1",
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────────

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ─── mock backends (always available, no API keys needed) ──────────────────────

const MOCK_RESPONSES = {
  chat: [
    "Based on your request, here is a concise and helpful response. The key points are: (1) understand the problem fully before attempting a solution, (2) break complex tasks into smaller steps, and (3) verify the output before delivering it.",
    "This is a simulated AI response from the MAMMBA AI Gateway mock backend. In production, this would be served by a real model provider like OpenAI, Anthropic, or Google.",
    "Here's what I found: the request was processed successfully through the AI Gateway. The mock backend is returning a placeholder response. Configure a real provider (OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_URL) to get actual model outputs.",
  ],
  embed: [0.1, -0.2, 0.3, 0.05, -0.1, 0.2, -0.05, 0.15, 0.0, -0.1, 0.25, -0.2, 0.1, 0.05, -0.15, 0.2, -0.05, 0.1, 0.0, -0.2],
  image: "https://picsum.photos/seed/mock-ai-8721/1024/1024",
  transcribe: "This is a simulated transcription from the MAMMBA AI Gateway mock backend.",
};

function mockChat(request) {
  const idx = Math.floor(Math.random() * MOCK_RESPONSES.chat.length);
  const text = MOCK_RESPONSES.chat[idx];
  return {
    id: `mock-chat-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: CONFIG.chat.defaultModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 50,
      completion_tokens: text.split(/\s+/).length,
      total_tokens: 50 + text.split(/\s+/).length,
    },
  };
}

function mockEmbeddings(request) {
  const input = Array.isArray(request.input) ? request.input : [request.input];
  return {
    object: "list",
    model: CONFIG.embed.defaultModel,
    data: input.map((_, i) => ({
      object: "embedding",
      index: i,
      embedding: MOCK_RESPONSES.embed,
    })),
    usage: {
      prompt_tokens: input.join(" ").split(/\s+/).length,
      total_tokens: input.join(" ").split(/\s+/).length,
    },
  };
}

function mockImage(request) {
  return {
    created: Math.floor(Date.now() / 1000),
    data: [
      {
        url: MOCK_RESPONSES.image,
        b64_json: null,
        revised_prompt: request.prompt,
      },
    ],
  };
}

function mockTranscribe(request) {
  return {
    text: MOCK_RESPONSES.transcribe,
    language: "en",
    duration_ms: 1200,
    segments: [
      { id: 0, seek: 0, start: 0, end: 1.2, text: MOCK_RESPONSES.transcribe, temperature: 0, avg_logprob: -0.1, no_speech_prob: 0.0 },
    ],
  };
}

// ─── provider adapters ─────────────────────────────────────────────────────────

/**
 * Chat provider adapters.
 * Each returns { status, body } where body is the provider's response object.
 */
async function chatWithOpenAI(request, apiKey) {
  const body = {
    model: request.model || CONFIG.chat.defaultModel,
    messages: request.messages,
    max_tokens: request.max_tokens ?? CONFIG.chat.maxTokens,
    temperature: request.temperature ?? CONFIG.chat.temperature,
    stream: false,
    ...(request.stop_sequences && { stop: request.stop_sequences }),
  };
  // Remove undefined values
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI error ${res.status}: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

async function chatWithAnthropic(request, apiKey) {
  const messages = request.messages || [];
  // Convert OpenAI-style messages to Anthropic format
  const system = messages.find((m) => m.role === "system")?.content || null;
  const convo = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: Array.isArray(m.content) ? m.content.map((c) => ({ type: "text", text: c })).flat() : [{ type: "text", text: m.content }],
  }));

  const body = {
    model: request.model || "claude-3-5-sonnet-20241022",
    max_tokens: request.max_tokens ?? CONFIG.chat.maxTokens,
    temperature: request.temperature ?? CONFIG.chat.temperature,
    messages: convo,
    ...(system && { system }),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  // Convert Anthropic response to OpenAI format for consistency
  return {
    id: `anth-resp-${data.id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: data.content?.[0]?.type === "text" ? data.content[0].text : JSON.stringify(data.content),
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: data.usage?.input_tokens || 0,
      completion_tokens: data.usage?.output_tokens || 0,
      total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  };
}

async function chatWithOllama(request, baseUrl) {
  const body = {
    model: request.model || "llama3",
    messages: request.messages || [],
    stream: false,
    ...(request.max_tokens && { options: { num_predict: request.max_tokens } }),
    ...(request.temperature !== undefined && { options: { temperature: request.temperature } }),
  };

  const res = await fetch(`${baseUrl.trim().replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Ollama error ${res.status}: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  return {
    id: `ollama-${data.model}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: data.message?.content || "" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: data.eval_count || 0,
      completion_tokens: data.gen_count || 0,
      total_tokens: (data.eval_count || 0) + (data.gen_count || 0),
    },
  };
}

// ─── embed adapters ─────────────────────────────────────────────────────────────

async function embedWithOpenAI(request, apiKey) {
  const input = Array.isArray(request.input) ? request.input : [request.input];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model || CONFIG.embed.defaultModel,
      input,
      encoding_format: request.encoding_format || "float",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI embeddings error ${res.status}: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

async function embedWithOllama(request, baseUrl) {
  const input = Array.isArray(request.input) ? request.input : [request.input];
  const res = await fetch(`${baseUrl.trim().replace(/\/$/, "")}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model || "nomic-embed-text",
      input,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Ollama embed error ${res.status}: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  return {
    object: "list",
    model: request.model || "nomic-embed-text",
    data: data.embeddings.map((emb, i) => ({ object: "embedding", index: i, embedding: emb })),
    usage: { prompt_tokens: input.join(" ").split(/\s+/).length, total_tokens: input.join(" ").split(/\s+/).length },
  };
}

// ─── image adapters ─────────────────────────────────────────────────────────────

async function imageWithOpenAI(request, apiKey) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model || CONFIG.image.defaultModel,
      prompt: request.prompt,
      n: request.n || 1,
      size: request.size || CONFIG.image.size,
      response_format: request.response_format || "url",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI image error ${res.status}: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

// ─── transcribe adapters ────────────────────────────────────────────────────────

async function transcribeWithOpenAI(request, apiKey) {
  // request.file should be a Buffer or base64 data URI
  let body;
  let contentType = "application/json";

  if (typeof request.file === "string" && request.file.startsWith("data:")) {
    // data URI — extract and send as form data
    const idx = request.file.indexOf(",");
    const mime = request.file.slice(5, idx);
    const raw = request.file.slice(idx + 1);
    const binary = Buffer.from(raw, "base64");
    const formBody = new FormData();
    formBody.append("file", new Blob([binary], { type: mime }), "audio.wav");
    formBody.append("model", request.model || CONFIG.transcribe.defaultModel);
    if (request.language) formBody.append("language", request.language);
    if (request.prompt) formBody.append("prompt", request.prompt);
    body = formBody;
    contentType = undefined; // fetch sets it for FormData
  } else if (Buffer.isBuffer(request.file) || request.file instanceof Uint8Array) {
    const formBody = new FormData();
    formBody.append("file", new Blob([request.file], { type: request.mime_type || "audio/wav" }), "audio.wav");
    formBody.append("model", request.model || CONFIG.transcribe.defaultModel);
    if (request.language) formBody.append("language", request.language);
    if (request.prompt) formBody.append("prompt", request.prompt);
    body = formBody;
    contentType = undefined;
  } else {
    throw new Error("transcribe: file must be a Buffer, Uint8Array, or data URI string");
  }

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI transcribe error ${res.status}: ${err.error?.message || res.statusText}`);
  }
  return res.json();
}

// ─── router dispatcher ──────────────────────────────────────────────────────────

async function dispatchChat(request) {
  const provider = CONFIG.chat.provider;
  if (provider === "mock") return mockChat(request);

  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ollamaUrl = process.env.OLLAMA_URL;

  switch (provider) {
    case "openai":
      if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");
      return chatWithOpenAI(request, openaiKey);
    case "anthropic":
      if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
      return chatWithAnthropic(request, anthropicKey);
    case "ollama":
      if (!ollamaUrl) throw new Error("OLLAMA_URL not configured");
      return chatWithOllama(request, ollamaUrl);
    default:
      throw new Error(`Unknown chat provider: ${provider}`);
  }
}

async function dispatchEmbeddings(request) {
  const provider = CONFIG.embed.provider;
  if (provider === "mock") return mockEmbeddings(request);

  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaUrl = process.env.OLLAMA_URL;

  switch (provider) {
    case "openai":
      if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");
      return embedWithOpenAI(request, openaiKey);
    case "ollama":
      if (!ollamaUrl) throw new Error("OLLAMA_URL not configured");
      return embedWithOllama(request, ollamaUrl);
    default:
      throw new Error(`Unknown embeddings provider: ${provider}`);
  }
}

async function dispatchImage(request) {
  const provider = CONFIG.image.provider;
  if (provider === "mock") return mockImage(request);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");
  return imageWithOpenAI(request, openaiKey);
}

async function dispatchTranscribe(request) {
  const provider = CONFIG.transcribe.provider;
  if (provider === "mock") return mockTranscribe(request);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");
  return transcribeWithOpenAI(request, openaiKey);
}

// ─── public API ──────────────────────────────────────────────────────────────────

export const aiGateway = {
  chat: async (request) => dispatchChat(request),
  embeddings: async (request) => dispatchEmbeddings(request),
  image: async (request) => dispatchImage(request),
  transcribe: async (request) => dispatchTranscribe(request),
  config: CONFIG,
};

// Export individual adapters for direct use
export { chatWithOpenAI, chatWithAnthropic, chatWithOllama };
export { embedWithOpenAI, embedWithOllama };
export { imageWithOpenAI };
export { transcribeWithOpenAI };
