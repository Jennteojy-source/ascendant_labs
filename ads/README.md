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

## Browser deployment

The collector launches local Chromium by default. Meta commonly blocks fresh datacenter/headless sessions, so production should connect Playwright to a trusted persistent browser rather than rely on the Cloud Run container's IP.

- `BROWSER_WS_ENDPOINT`: preferred Playwright WebSocket endpoint (`chromium.connect`).
- `BROWSER_CDP_ENDPOINT`: Chrome DevTools endpoint for an existing Chromium session (`connectOverCDP`).
- `BROWSER_REUSE_DEFAULT_CONTEXT=1`: reuse the remote browser's persistent default context and cookies.
- `META_BROWSER_STORAGE_STATE`: optional Playwright storage-state JSON used when creating isolated contexts.

No Meta Ads Library API token is read or transmitted. `CAPI_ACCESS_TOKEN` belongs to the separate first-party conversion-event service under `functions/` and is not used by the collector.
