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
│   ├── ai_query_expander.js             # Grounded product profile and query expansion
│   ├── ai_retrieval_agent.js            # Gemini follow-up search planning
│   ├── ai_reranker.js                   # Gemini relevance judgment for every candidate
│   ├── product_identity.js             # Evidence used for recall and safe fallback
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
npm test                              # Run search and media regression tests
```

## Managed browser deployment

Production connects outbound to a managed browser service. The project does not open a Chrome debugging port, run a tunnel, or accept inbound browser-control connections.

### Browser collection
The Cloud Run Chromium instance handles searches and ad previews. Blocked detail
previews are skipped without a paid residential retry by default. Set
`MEDIA_SNIFF_RESIDENTIAL_FALLBACK=1` only if a paid Browserless fallback is intended.
The browser is warmed
before Cloud Run reports readiness, avoiding a first-search launch penalty.
`BROWSER_WS_ENDPOINT` remains an optional explicit managed-browser override,
but production has no Browserless credential mounted.

Creatives are copied into a private Cloud Storage bucket only when their card is viewed, then served through `/api/media/...` with immutable caching and video range requests:

- `MEDIA_STORAGE_BUCKET`: optional bucket name (default: `ascendant-labs-45812-ad-media`).
- `MEDIA_PERSIST_CONCURRENCY`: simultaneous media copies (default: `2`, maximum: `4`).
- `MEDIA_STORAGE_DISABLED=1`: disable durable copies and retain verified Meta CDN fallbacks.

Search results may include creative URLs from Meta's response. For visible cards,
the server now uses those ad-bound URLs first and copies accessible media into Cloud
Storage without opening the per-ad detail page. This matters when Meta serves search
results but denies a separate detail request. The detail page remains a fallback when
search provided no media. Direct CDN URLs can expire or return an error. If an image
or video cannot load in the user's browser, the card forces one fresh detail request
per search. A `blocked` preview
means the detail page returned a login, checkpoint, challenge, or denial response;
`unavailable` means no usable creative was extracted, which does not itself prove
that Meta blocked access. Check `Ad media extraction completed` and `Asset ingestion
failed` logs for the affected ad ID.

An authenticated browser can be tested by setting `META_BROWSER_STORAGE_STATE` to
the path of a Playwright storage-state JSON file generated from a dedicated test
account. The same state is used for search and detail contexts. Keep the file outside
source control and refresh it when the session expires. `FACEBOOK_EMAIL` and
`FACEBOOK_PASSWORD` in `.env` are not consumed by the collector, and a login does
not guarantee that Meta will serve every ad or CDN asset.

Apply `storage-lifecycle.json` to the bucket to delete cached analysis media after 14 days.

### Other managed Playwright providers
- `BROWSER_WS_ENDPOINT`: Accepts an encrypted `wss://` Playwright server endpoint.

### Local development fallback
Fallback mode: launches local headless Chromium when no remote endpoints are configured.

No Meta Ads Library API token is read or transmitted. The web search pipeline first asks Gemini to research the product with Google Search grounding, then uses a structured Gemini response to plan Meta queries. Grounded aliases can be used in follow-up queries. Gemini judges every candidate before the API presents named-offer matches; an exact name match supports a conservative fallback if the model is unavailable. The grounded profile and sources are returned in `queryProfile` and recorded with search history. Configure `VERTEX_GEMINI_MODEL` only to override the default `gemini-3.8-flash` model. Google Search grounding adds a Vertex request and may increase search latency and cost.

The `country=ALL` search filter is not an ad's target or delivery geography.
Results show countries only when Meta supplies ad-bound reached, included or excluded
audience locations, or targeted-or-reached country fields. The UI labels that evidence
separately and omits locations when the evidence is absent. A targeted country does not prove that the ad
received impressions there; the public Library does not provide a complete
country-by-country delivery list for every commercial ad.

Cloud Logging records search vector durations/failures, each ad preview outcome,
asset download outcomes and bytes, and Vertex input/output/cached token counts.
For the default global Gemini 3.8 Flash model, it estimates USD token cost using
Google's introductory Standard rates through 2026. Override
`VERTEX_INPUT_USD_PER_MILLION_TOKENS`, `VERTEX_OUTPUT_USD_PER_MILLION_TOKENS`, and
`VERTEX_CACHED_INPUT_USD_PER_MILLION_TOKENS` when the model, region, or prices change.
