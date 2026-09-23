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
npm run ad:server
npm run ad:search -- "product or brand"
npm run test:media
```

## Managed browser deployment

Production connects outbound to a managed browser service. The project does not open a Chrome debugging port, run a tunnel, or accept inbound browser-control connections.

Browserless is the default hosted provider:

- `BROWSERLESS_TOKEN`: Browserless dashboard token. Store it as a Cloud Run secret.
- `BROWSERLESS_REGION`: optional `sfo`, `lon`, or `ams` (default: `sfo`).
- `BROWSERLESS_PROXY_COUNTRY`: optional two-letter residential exit country (default: `us`).

For another managed provider, `BROWSER_WS_ENDPOINT` accepts an encrypted Playwright-native `wss://` endpoint. Plain HTTP endpoints are rejected. `BROWSER_REUSE_DEFAULT_CONTEXT=1` and `META_BROWSER_STORAGE_STATE` remain optional for providers that support persistent contexts.

No Meta Ads Library API token is read or transmitted. `CAPI_ACCESS_TOKEN` belongs to the separate first-party conversion-event service under `functions/` and is not used by the collector.
