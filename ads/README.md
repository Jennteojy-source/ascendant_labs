# 📁 Ascendant Labs Ads & Creative Asset Directory

This directory contains browser-first Meta Ad intelligence, ClickBank marketplace analytics, creative generation suites, and performance spy tooling for Ascendant Labs ClickBank affiliate campaigns. Ad discovery uses the public Ads Library through Playwright and does not require an Ads Library API token.

---

## 🗂️ Directory Structure

```text
ads/
├── README.md                           # This index file
├── affiliate_spy_engine.js             # Browser-first Meta Ad Library spy engine
├── ad_effectiveness_estimator.js       # Scoring & CTR/spend estimator algorithms
├── find_clickbank_ads.js               # Meta Ads Library scraper for ClickBank hoplinks & affiliate campaigns
├── get_top_active_scaling_ads.js       # Filters top active high-scale ads across ClickBank offers
├── get_english_active_scaled_ads.js    # Discovers top active scaled ads in US/UK/CA/AU/NZ
├── scrape_clickbank_marketplace.js     # ClickBank Marketplace catalog extractor
├── spy_clickbank_offers.js             # Automated offer intelligence crawler
├── clickbank_affiliate_ads.json        # 500+ Scraped Meta affiliate ads promoting ClickBank hoplinks
├── clickbank_marketplace_full.json     # ClickBank marketplace offers dataset
├── prodentim/                          # ProDentim campaign creative & copy suite
│   ├── creatives/                      # 27 high-performing image & video variants
│   ├── meta_ad_copy_5_variants.md      # Direct-response ad copy variants
│   ├── high_performing_ad_creatives.md # Creative testing matrix
│   └── recreate_tongue_ad.js           # Programmatic ad creative generator
├── creatives/
│   └── brain_training_for_dogs/        # Brain Training for Dogs ad creatives
├── prompts/
│   └── clickbank_affiliate/            # ClickBank Affiliate Ad Creative & Copy Playbooks
│       ├── clickbank_ad_creative_generation.md
│       └── brain_training_for_dogs_playbook.md
├── lib/
│   ├── meta_browser_searcher.js         # Public Library search + JSON/DOM extraction
│   ├── paginated_sniffer.js             # Per-ad image/video refresh and caching
│   ├── llm_evaluator.js
│   ├── report_generator.js
│   └── funnel_inspector.js
└── logos/
    ├── ascendant_labs_logo_warm.png
    ├── ascendant_labs_logo_icon.png
    └── ascendant_labs_profile_logo.png
```

---

## 🚀 ClickBank Affiliate Operations

### 1. Spy on Competitor Ads for Any Affiliate Program or Product:
```bash
# Spy on any offer link or domain (e.g. ProDentim or Derila):
npm run spy -- "https://prodentim.com"
npm run spy -- "https://derila-ergo.com" --status ACTIVE
```

### 2. Discover Top Scaling Active Ads:
```bash
# Find active scaled ads across top ClickBank offers:
npm run cb:scaled

# Discover live ClickBank affiliate ads running across Meta:
npm run cb:ads
```

### 3. Scrape ClickBank Marketplace:
```bash
npm run cb:marketplace
```

### 4. Creative Suites:
- **ProDentim**: See [`ads/prodentim/`](prodentim/README.md) for 27 visual creatives, video hooks, and 5 copy angles.
- **Brain Training for Dogs**: See [`ads/creatives/brain_training_for_dogs/`](creatives/brain_training_for_dogs/) and [`ads/prompts/clickbank_affiliate/brain_training_for_dogs_playbook.md`](prompts/clickbank_affiliate/brain_training_for_dogs_playbook.md).

## Browser deployment

The collector launches local Chromium by default. Meta commonly blocks fresh datacenter/headless sessions, so production should connect Playwright to a trusted persistent browser rather than rely on the Cloud Run container's IP.

- `BROWSER_WS_ENDPOINT`: preferred Playwright WebSocket endpoint (`chromium.connect`).
- `BROWSER_CDP_ENDPOINT`: Chrome DevTools endpoint for an existing Chromium session (`connectOverCDP`).
- `BROWSER_REUSE_DEFAULT_CONTEXT=1`: reuse the remote browser's persistent default context and cookies.
- `META_BROWSER_STORAGE_STATE`: optional Playwright storage-state JSON used when creating isolated contexts.

No Meta Ads Library API token is read or transmitted. `CAPI_ACCESS_TOKEN` belongs to the separate first-party conversion-event service under `functions/` and is not used by the collector.
