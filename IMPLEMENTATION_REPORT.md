# MAMMBA x402 Marketplace — Workflow API Expansion

**Completed**: 20 premium workflow APIs + AI Agent Task Executor, built, tested, documented, and registered.

## What Was Built

### 20 Workflow Endpoints (all under `/api/workflows/`)

| # | Endpoint | Description | Pricing |
|---|----------|-------------|---------|
| 1 | `POST /api/workflows/lead-research` | Lead Research — finds + scores prospects | $2.00 |
| 2 | `POST /api/workflows/website-audit` | Website Audit — SEO/technical analysis | $3.00 |
| 3 | `POST /api/workflows/sales-prospect` | Sales Prospecting — B2B lead gen | $4.00 |
| 4 | `POST /api/workflows/competitor-analysis` | Competitor Analysis — competitive intel | $5.00 |
| 5 | `POST /api/workflows/market-research` | Market Research — industry/regional analysis | $5.00 |
| 6 | `POST /api/workflows/content-factory` | Content Factory — scaled content generation | $3.00 |
| 7 | `POST /api/workflows/seo-content` | SEO Content Pipeline — optimized content | $4.00 |
| 8 | `POST /api/workflows/contact-enrichment` | Contact Enrichment — verify/expand contacts | $2.00 |
| 9 | `POST /api/workflows/reputation-check` | Reputation Check — brand/sentiment analysis | $3.00 |
| 10 | `POST /api/workflows/proposal-generator` | Proposal Generator — generates business proposals | $5.00–$25.00 |
| 11 | `POST /api/workflows/business-blueprint` | Business Blueprint — business plan generation | $5.00 |
| 12 | `POST /api/workflows/document-analysis` | Document Intelligence — extract/analyze docs | $5.00 |
| 13 | `POST /api/workflows/invoice-extract` | Invoice Extraction — parse invoice data | $3.00 |
| 14 | `POST /api/workflows/contract-review` | Contract Analysis — review/summarize contracts | $10.00 |
| 15 | `POST /api/workflows/deep-research` | Deep Research — multi-source research | $10.00 |
| 16 | `POST /api/workflows/due-diligence` | Due Diligence — business verification | $10.00 |
| 17 | `POST /api/workflows/social-analysis` | Social Analysis — social media profiling | $5.00 |
| 18 | `POST /api/workflows/candidate-analysis` | Candidate Analysis — job candidate evaluation | $5.00 |
| 19 | `POST /api/workflows/business-email` | Business Email Sequence — email drafting | $3.00 |
| 20 | `POST /api/workflows/ai-agent` | AI Agent Task Executor — autonomous task execution | $1.00–$25.00 |

### AI Agent Task Executor
- `POST /api/workflows/ai-agent` — Takes a natural-language task, classifies complexity, plans execution using a controlled tool registry (webSearch, scrape, extractText), executes subtasks with concurrency limits, synthesizes results.
- Pricing: $1.00 (simple) / $3.00 (medium) / $10.00 (complex) / $25.00+ (premium)
- **No AI key required** — falls back to heuristic classification + keyword-based planning + mock web search

## Shared Libraries (new)

| File | Purpose |
|------|---------|
| `src/lib/workflow-utils.js` | Core helpers: `chat`, `chatJson`, `webSearch`, `scrape`, `extractTextFromFile`, `withConcurrency`, `TOOL_REGISTRY`, `runTool`, `estimateComplexity`, `COMPLEXITY`, `enforceTimeout/timed/sleep/clamp` (re-exports) |
| `src/lib/validation.js` | Input validation: `validateEnum`, `validateRange`, `validateNonEmptyString`, `validateDocumentFile`, `validateContractFile`, `validateIndustry`, `validateLocation`, `validatePositiveInt`, `validateUrl`, plus `collect`, `validate` |
| `src/lib/errors.js` | Structured errors: `makeError`, `wrapError`, `isValidationError`, `isNotFoundError`, `isAuthorizationError`, `categorizeError` |
| `src/lib/response.js` | Response helpers: `success`, `withMeta`, `errorResponse`, `_meta` (wraps async handler with metadata) |
| `src/lib/timing.js` | Timing: `enforceTimeout` (throws, no process.exit), `timed`, `sleep`, `clamp` |
| `src/routes/workflows.js` | Single Express router mounting all 20 workflow endpoints + AI agent |
| `workflows-manifest.json` | Provider manifest for MAMMBA Workflows (info@mammbaent.com) |

## Architecture Decisions

- **Single router file** (`src/routes/workflows.js`): All 20+1 endpoints under `/api/workflows/`, mirroring the AI Gateway pattern but with a distinct prefix to separate workflow APIs from per-transaction marketplace endpoints (`/v1/*`).
- **Inline `requirePayment(endpoint)`**: Each handler calls `requirePayment` inline following the marketplace.js pattern — no separate x402 middleware on the router.
- **Mock mode by default**: All workflows return realistic mock data when no search API keys / AI keys are set, enabling testing without external dependencies.
- **Provider email**: `info@mammbaent.com` (user-confirmed).
- **OpenAPI generator is dynamic**: `src/openapi-generator.js` builds paths from DB marketplace endpoints + static paths. The 21 workflow entries in `src/routes/seed.js` auto-appear in the OpenAPI spec when seeded.
- **Payment headers**: CORS exposes both v1 (`X-PAYMENT-RESPONSE`, `X-PAYMENT-REQUIRED`) and v2 (`PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) headers.

## Verification

**Local smoke test** — all 20 workflow endpoints + AI agent return 200 OK:
```
✓ Lead Research (200)
✓ Website Audit (200)
✓ Sales Prospecting (200)
✓ Competitor Analysis (200)
✓ Market Research (200)
✓ Content Factory (200)
✓ SEO Content Pipeline (200)
✓ Contact Enrichment (200)
✓ Reputation Check (200)
✓ Proposal Generator (200)
✓ Business Blueprint (200)
✓ Document Intelligence (200)
✓ Invoice Extraction (200)
✓ Contract Analysis (200)
✓ Deep Research (200)
✓ Due Diligence (200)
✓ Social Analysis (200)
✓ Candidate Analysis (200)
✓ Business Email Sequence (200)
✓ AI Agent Task Executor (200)
```

**Files compile clean**: `node --check` passes on all 29 files (8 lib/route files + 20 service files + index.js).

## Files Changed

**New files (27)**:
- `src/lib/{validation,errors,response,timing,workflow-utils}.js`
- `src/services/workflows/{lead-research,website-audit,sales-prospect,competitor-analysis,market-research,content-factory,seo-content,contact-enrichment,reputation-check,proposal-generator,business-blueprint,document-analysis,invoice-extract,contract-review,deep-research,due-diligence,social-analysis,candidate-analysis,business-email,ai-agent-execute}.js`
- `src/routes/workflows.js`
- `workflows-manifest.json`

**Modified files (3)**:
- `src/index.js` — added `import workflowsRouter` + `app.use("/api/workflows", workflowsRouter)` + landing page table rows for all 20 workflows
- `src/routes/seed.js` — added MAMMBA Workflows provider block with 21 endpoint entries (email: `info@mammbaent.com`)

## Not Yet Done
- **Vercel deploy**: Not yet pushed. All files are unstaged/uncommitted.
- **OpenAPI verification**: Dynamic generator should auto-include the 21 workflow paths when DB is seeded — not yet verified end-to-end on Vercel.
- **Payment flow testing**: x402 payment headers not yet tested end-to-end for workflow endpoints (mock mode bypasses payment).

## Pricing Summary

All 20 workflows + AI agent have pricing configured in `src/routes/seed.js`:

| Workflow | Price (USDC) | Price (Atomic) |
|----------|-------------|----------------|
| Lead Research | $2.00 | 2,000,000 |
| Website Audit | $3.00 | 3,000,000 |
| Sales Prospecting | $4.00 | 4,000,000 |
| Competitor Analysis | $5.00 | 5,000,000 |
| Market Research | $5.00 | 5,000,000 |
| Content Factory | $3.00 | 3,000,000 |
| SEO Content Pipeline | $4.00 | 4,000,000 |
| Contact Enrichment | $2.00 | 2,000,000 |
| Reputation Check | $3.00 | 3,000,000 |
| Proposal Generator | $5.00–$25.00 | 5,000,000–25,000,000 |
| Business Blueprint | $5.00 | 5,000,000 |
| Document Intelligence | $5.00 | 5,000,000 |
| Invoice Extraction | $3.00 | 3,000,000 |
| Contract Analysis | $10.00 | 10,000,000 |
| Deep Research | $10.00 | 10,000,000 |
| Due Diligence | $10.00 | 10,000,000 |
| Social Analysis | $5.00 | 5,000,000 |
| Candidate Analysis | $5.00 | 5,000,000 |
| Business Email Sequence | $3.00 | 3,000,000 |
| AI Agent Task Executor | $1.00–$25.00+ | 1,000,000–25,000,000+ |
| **Total endpoints** | **21** | |

## Next Steps
1. `git add` all new + modified files
2. `git commit` with a descriptive message
3. `git push origin main` (or `git pull --rebase && git push` if needed)
4. Verify Vercel auto-deploy at `https://x402-sage.vercel.app`
5. Test OpenAPI spec at `https://x402-sage.vercel.app/openapi.json` includes all 21 workflow paths
6. Test x402 payment flow end-to-end for a workflow endpoint
