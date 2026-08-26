-- Persist API contracts so marketplace discovery documents the proxied endpoint accurately.
ALTER TABLE endpoints
  ADD COLUMN IF NOT EXISTS query_parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS request_body_schema JSONB,
  ADD COLUMN IF NOT EXISTS response_schema JSONB;

CREATE OR REPLACE VIEW v_marketplace_listing AS
SELECT
    e.id,
    e.slug,
    e.name,
    e.description,
    e.category,
    e.tags,
    e.method,
    e.price_atomic,
    e.price_display,
    e.total_calls,
    e.total_revenue,
    e.query_parameters,
    e.request_body_schema,
    e.response_schema,
    e.created_at,
    p.name AS provider_name
FROM endpoints e
JOIN providers p ON p.id = e.provider_id
WHERE e.status = 'active'
  AND p.status = 'active';

-- Known demo endpoints have no required query parameters; document their public JSON responses.
UPDATE endpoints
SET response_schema = CASE slug
  WHEN 'inspirational-quote' THEN '{
    "type":"array",
    "items":{"type":"object","required":["q","a"],"properties":{"q":{"type":"string","description":"Quote text"},"a":{"type":"string","description":"Author"},"h":{"type":"string","description":"HTML-formatted quote"}}}
  }'::jsonb
  WHEN 'random-meme' THEN '{
    "type":"object",
    "required":["title","url"],
    "properties":{"title":{"type":"string"},"url":{"type":"string","format":"uri"},"postLink":{"type":"string","format":"uri"},"subreddit":{"type":"string"},"author":{"type":"string"},"nsfw":{"type":"boolean"},"spoiler":{"type":"boolean"}}
  }'::jsonb
  WHEN 'random-joke' THEN '{
    "type":"object",
    "required":["error","category","type","id","safe","lang"],
    "properties":{"error":{"type":"boolean"},"category":{"type":"string"},"type":{"type":"string","enum":["single","twopart"]},"joke":{"type":"string","description":"Present when type is single"},"setup":{"type":"string","description":"Present when type is twopart"},"delivery":{"type":"string","description":"Present when type is twopart"},"id":{"type":"integer"},"safe":{"type":"boolean"},"lang":{"type":"string"}}
  }'::jsonb
  ELSE response_schema
END,
query_parameters = COALESCE(query_parameters, '[]'::jsonb)
WHERE slug IN ('inspirational-quote', 'random-meme', 'random-joke');
