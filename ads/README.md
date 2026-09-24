# Ascendant Labs AI Ad Search

This directory contains the browser-first search engine behind the Ascendant Labs website. It searches the public Meta Ads Library through Playwright, ranks relevant ads, resolves their creative media, and serves the website API. It does not require an Ads Library API token.

---

## Directory structure

```text
ads/
├── README.md                           # This index file
├── server.js                           # Website and JSON API server
├── agentic_ad_search.js                # CLI for the same search pipeline
├── lib/
│   ├── meta_browser_searcher.js         # Public Library search + JSON/DOM extraction
│   ├── paginated_sniffer.js             # Per-ad image/video refresh and caching
│   ├── media_resolver.js                # Safe image/video normalization
│   ├── comparable_finder.js             # Multi-vector browser search
│   ├── ad_ranker.js                     # Deduplication and ranking
│   ├── ai_query_expander.js             # Search-query expansion
│   ├── ai_reranker.js                   # Relevance reranking
│   ├── pdp_profiler.js                  # Product-page analysis
│   ├── firestore_cache.js               # Short-lived media cache
│   ├── search_logger.js                 # Search history
│   └── gcp_logger.js                    # Structured service logging
└── tests/                               # Extraction and rendering regression tests
```

## Commands

```bash
npm run ad:server                     # Start web server and API
npm run ad:search -- "product"        # Run multi-vector agentic search CLI
npm run test:media                    # Run regression test suite
```

## Managed browser deployment

Production connects outbound to a managed browser service. The project does not open a Chrome debugging port, run a tunnel, or accept inbound browser-control connections.

### Browserless
The local Cloud Run browser handles searches and first-pass ad previews. If Meta blocks an ad detail page, the preview worker may retry that ad once through Browserless residential proxying. Retry volume is capped at two sessions per minute per instance, with a ten-minute cooldown per ad.

Outbound WebSocket connection to the fallback provider:
- `BROWSERLESS_API` (or `BROWSERLESS_TOKEN`): Browserless dashboard token, mounted from Secret Manager in production.
- `BROWSERLESS_REGION`: optional `sfo`, `lon`, or `ams` (default: `sfo`).
- `BROWSERLESS_PROXY_COUNTRY`: optional two-letter residential exit country (default: `us`).
- `BROWSERLESS_FALLBACKS_PER_MINUTE`: optional per-instance retry cap (default: `2`; `0` disables retries).
- `BROWSERLESS_PRIMARY=1`: opt in to using Browserless for all searches instead of the local browser.

Creatives are copied into a private Cloud Storage bucket only when their card is viewed, then served through `/api/media/...` with immutable caching and video range requests:

- `MEDIA_STORAGE_BUCKET`: optional bucket name (default: `ascendant-labs-45812-ad-media`).
- `MEDIA_PERSIST_CONCURRENCY`: simultaneous media copies (default: `2`, maximum: `4`).
- `MEDIA_STORAGE_DISABLED=1`: disable durable copies and retain verified Meta CDN fallbacks.

Apply `storage-lifecycle.json` to the bucket to delete cached analysis media after 14 days.

### Other managed Playwright providers
- `BROWSER_WS_ENDPOINT`: Accepts an encrypted `wss://` Playwright server endpoint.

### Local development fallback
Fallback mode: launches local headless Chromium when no remote endpoints are configured.

No Meta Ads Library API token is read or transmitted. Query expansion and reranking use Vertex AI with the Cloud Run service account; configure `VERTEX_GEMINI_MODEL` only to override the default `gemini-3.8-flash` model.

Cloud Logging records search vector failures, each ad preview outcome, residential retries, asset download outcomes and bytes, and Vertex input/output/cached token counts. For the default global Gemini 3.8 Flash model, it estimates USD token cost using Google's introductory Standard rates through 2026. Override `VERTEX_INPUT_USD_PER_MILLION_TOKENS`, `VERTEX_OUTPUT_USD_PER_MILLION_TOKENS`, and `VERTEX_CACHED_INPUT_USD_PER_MILLION_TOKENS` when the model, region, or prices change.
