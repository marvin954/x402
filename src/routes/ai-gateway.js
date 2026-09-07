/**
 * AI Gateway Route — POST /v1/chat · /v1/embeddings · /v1/image · /v1/transcribe
 *
 * Unified gateway to multiple AI providers (OpenAI, Anthropic, Ollama, mock).
 * All endpoints are paid marketplace services.
 *
 * Request body shapes:
 *   /v1/chat:
 *     { "model"?: string, "messages": [{role, content}[]], "max_tokens"?: number,
 *       "temperature"?: number, "stream"?: false, "stop"?: string[] }
 *   /v1/embeddings:
 *     { "model"?: string, "input": string | string[], "encoding_format"?: "float"|"base64" }
 *   /v1/image:
 *     { "model"?: string, "prompt": string, "n"?: number, "size"?: "256x256"|"512x512"|"1024x1024"|"1792x1024"|"1024x1792", "response_format"?: "url"|"b64_json" }
 *   /v1/transcribe:
 *     { "file": Buffer|Uint8Array|data-URI, "model"?: string, "language"?: string, "prompt"?: string, "mime_type"?: string }
 *
 * Response: provider-native format (OpenAI-compatible for chat/embeddings/image).
 */
import { Router } from "express";
import { aiGateway } from "../services/ai-gateway.js";

const router = Router();

// ─── POST /v1/chat ──────────────────────────────────────────────────────────────

router.post("/chat", async (req, res) => {
  try {
    const { model, messages, max_tokens, temperature, stream, stop, ...extra } = req.body ?? {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Request body must contain { \"messages\": [{ role, content }] }" });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        return res.status(400).json({ error: "Each message must have { role, content }" });
      }
      if (!["system", "user", "assistant", "tool"].includes(msg.role)) {
        return res.status(400).json({ error: `Invalid message role: ${msg.role}. Must be system, user, assistant, or tool.` });
      }
    }

    const request = {
      model:      model || undefined,
      messages:   messages,
      max_tokens: max_tokens !== undefined ? max_tokens : undefined,
      temperature: temperature !== undefined ? temperature : undefined,
      stop:       stop || undefined,
    };

    const start = Date.now();
    let result;
    let error;

    try {
      result = await aiGateway.chat(request);
    } catch (err) {
      error = err;
    }

    const timeMs = Date.now() - start;

    if (error) {
      return res.status(502).json({
        error: "AI provider error",
        details: error.message,
        provider: aiGateway.config.chat.provider,
      });
    }

    res.json({
      ...result,
      _meta: {
        provider: aiGateway.config.chat.provider,
        model: model || aiGateway.config.chat.defaultModel,
        responseTimeMs: timeMs,
      },
    });
  } catch (err) {
    console.error("[ai-gateway] /chat error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/embeddings ────────────────────────────────────────────────────────

router.post("/embeddings", async (req, res) => {
  try {
    const { model, input, encoding_format } = req.body ?? {};

    if (!input) {
      return res.status(400).json({ error: 'Request body must contain { "input": "text" | ["text1", "text2"] }' });
    }

    if (typeof input !== "string" && !Array.isArray(input)) {
      return res.status(400).json({ error: '"input" must be a string or array of strings' });
    }

    if (Array.isArray(input) && input.length === 0) {
      return res.status(400).json({ error: '"input" array must not be empty' });
    }

    // Limit batch size
    if (Array.isArray(input) && input.length > 2048) {
      return res.status(400).json({ error: "Too many inputs — max 2048 per request" });
    }

    const request = {
      model:      model || undefined,
      input:      input,
      encoding_format: encoding_format || undefined,
    };

    const start = Date.now();
    let result;
    let error;

    try {
      result = await aiGateway.embeddings(request);
    } catch (err) {
      error = err;
    }

    const timeMs = Date.now() - start;

    if (error) {
      return res.status(502).json({
        error: "AI provider error",
        details: error.message,
        provider: aiGateway.config.embed.provider,
      });
    }

    res.json({
      ...result,
      _meta: {
        provider: aiGateway.config.embed.provider,
        model: model || aiGateway.config.embed.defaultModel,
        responseTimeMs: timeMs,
      },
    });
  } catch (err) {
    console.error("[ai-gateway] /embeddings error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/image ─────────────────────────────────────────────────────────────

router.post("/image", async (req, res) => {
  try {
    const { prompt, model, n, size, response_format } = req.body ?? {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: 'Request body must contain { "prompt": "a description of the image" }' });
    }

    // Basic prompt safety
    if (prompt.length > 4000) {
      return res.status(400).json({ error: "Prompt too long — max 4000 characters" });
    }

    const request = {
      model:          model || undefined,
      prompt:         prompt,
      n:              n !== undefined ? n : undefined,
      size:           size || undefined,
      response_format: response_format || undefined,
    };

    const start = Date.now();
    let result;
    let error;

    try {
      result = await aiGateway.image(request);
    } catch (err) {
      error = err;
    }

    const timeMs = Date.now() - start;

    if (error) {
      return res.status(502).json({
        error: "AI provider error",
        details: error.message,
        provider: aiGateway.config.image.provider,
      });
    }

    res.json({
      ...result,
      _meta: {
        provider: aiGateway.config.image.provider,
        model: model || aiGateway.config.image.defaultModel,
        responseTimeMs: timeMs,
      },
    });
  } catch (err) {
    console.error("[ai-gateway] /image error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /v1/transcribe ────────────────────────────────────────────────────────

router.post("/transcribe", async (req, res) => {
  try {
    const { file, model, language, prompt, mime_type } = req.body ?? {};

    if (!file) {
      return res.status(400).json({ error: 'Request body must contain { "file": Buffer | Uint8Array | "data:audio/wav;base64,..." }' });
    }

    // Accept file as Buffer, Uint8Array, or data URI string
    let processedFile = file;
    if (typeof file === "string" && file.startsWith("data:")) {
      // Valid data URI — pass through
      processedFile = file;
    } else if (Buffer.isBuffer(file) || file instanceof Uint8Array) {
      processedFile = file;
    } else {
      return res.status(400).json({ error: '"file" must be a Buffer, Uint8Array, or data URI string' });
    }

    const request = {
      file:        processedFile,
      model:       model || undefined,
      language:    language || undefined,
      prompt:      prompt || undefined,
      mime_type:   mime_type || undefined,
    };
    const start = Date.now();
    let result;
    let error;

    try {
      result = await aiGateway.transcribe(request);
    } catch (err) {
      error = err;
    }

    const timeMs = Date.now() - start;

    if (error) {
      return res.status(502).json({
        error: "AI provider error",
        details: error.message,
        provider: aiGateway.config.transcribe.provider,
      });
    }

    res.json({
      ...result,
      _meta: {
        provider: aiGateway.config.transcribe.provider,
        model: model || aiGateway.config.transcribe.defaultModel,
        responseTimeMs: timeMs,
      },
    });
  } catch (err) {
    console.error("[ai-gateway] /transcribe error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
