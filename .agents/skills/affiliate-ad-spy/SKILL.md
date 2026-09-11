---
name: affiliate-ad-spy
description: Discovers, audits, and reverse-engineers Meta ads promoting any affiliate program, tracking link, or product domain. Estimates CTR, CPC, impressions, spend, copy triggers, and bridge page effectiveness. Activate when the user provides an affiliate URL, tracking link, product domain, or asks to spy on competitor ads and estimate performance.
---

# Affiliate Ad Spy & Performance Intelligence Skill

This skill allows Antigravity to reverse-engineer competitor affiliate campaigns on Meta (Facebook & Instagram), uncover winning creatives, inspect the landing page funnel (direct vs. bridge page), and algorithmically estimate performance metrics (CTR, CPC, impressions, ad spend, and overall effectiveness).

Inspired by commercial ad intelligence tools like **AdPlexity** and **AdSpy**, this engine searches across redirect chains, affiliate network footprints, and brand keywords, then scores each ad based on flight duration longevity, copy triggers, and delivery scale.

---

## When to Activate

Activate this skill when:
- The user provides an affiliate tracking URL (e.g., Tune/HasOffers, ClickBank, TradeDoubler, Skimlinks, BuyGoods, Digistore24).
- The user provides an e-commerce or SaaS product domain (e.g., `derila-ergo.com`, `prodentim.com`, `nordvpn.com`).
- The user asks to "spy on", "audit", or "find ads for" a specific affiliate program or offer.
- The user asks to estimate CTR, CPC, or effectiveness of ads running for a product.
- The user triggers `/affiliate-ad-spy` or `/spy`.

---

## CLI Tools & Execution

The core engine is located at [`ads/affiliate_spy_engine.js`](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/ads/affiliate_spy_engine.js).

### Primary Usage

Run via Node:
```bash
node ads/affiliate_spy_engine.js "<AFFILIATE_OR_PRODUCT_URL>" [options]
```

Or via NPM shortcut:
```bash
npm run spy -- "<AFFILIATE_OR_PRODUCT_URL>" [options]
```

### Supported CLI Flags

| Flag | Shorthand | Description | Default |
|---|---|---|---|
| `--url <url>` | `-u` | Affiliate tracking link or product domain | Target URL |
| `--countries <codes>` | `-c` | Comma-separated 2-letter country codes | `US,GB,CA,AU` |
| `--status <status>` | `-s` | Ad delivery status: `ALL`, `ACTIVE`, `INACTIVE` | `ALL` |
| `--limit <number>` | `-l` | Max ads fetched per search vector query | `50` |
| `--output <path>` | `-o` | Custom export JSON filepath | `ads/spy_results_<brand>.json` |
| `--help` | `-h` | Display usage instructions | - |

### Quick Examples

```bash
# Spy on NordVPN HasOffers affiliate offer:
node ads/affiliate_spy_engine.js "https://go.nordvpn.net/aff_c?offer_id=15"

# Spy on an e-commerce affiliate offer (Derila Pillow), active ads only:
node ads/affiliate_spy_engine.js "https://derila-ergo.com" --status ACTIVE

# Spy on a ClickBank dental supplement across US and CA:
node ads/affiliate_spy_engine.js "https://prodentim.com" -c US,CA -l 100
```

---

## Supported Affiliate Networks & Footprints

The engine automatically recognizes affiliate tracking signatures:

1. **Tune / HasOffers**:
   - Domains: `*.aff_c`, `go.nordvpn.net`, `go.getproton.me`, `nordpass.io`
   - Detects `offer_id` parameter to isolate ads promoting that exact offer.
2. **ClickBank**:
   - Domains: `*.hop.clickbank.net`, vendor IDs in slug or search parameters.
3. **TradeDoubler**:
   - Domains: `tradedoubler.com`, extracts partner `p` IDs.
4. **Skimlinks & BuyGoods & Digistore24**:
   - Automatically identified via host patterns.
5. **Direct Merchant / DTC E-Commerce**:
   - Automatically strips subdomains and slug structures to identify core brand and deal variations (e.g., `derila-ergo.com` $\rightarrow$ `derila`, `derila deal`, `derila discount`).

---

## Performance Estimation Methodology

Since Meta does not publicly expose proprietary advertiser CTRs or exact dollar spends, the engine applies the **AdPlexity / AdSpy Continuous Run-Time & Creative Heuristic Model**:

### 1. Effectiveness Score (0–100)
- **Flight Longevity (0–40 pts)**:
  - $\ge 20$ days continuous: 40 pts (Proven profitable winner; no advertiser burns budget for 3+ weeks on negative ROI).
  - 14–19 days: 34 pts.
  - 8–13 days: 28 pts.
  - 4–7 days: 20 pts.
  - 1–3 days: 5–12 pts (Killed test or unproven dud).
  - Active bonus: +4 pts if ad is currently running.
- **Copy & Psychological Triggers (0–30 pts)**:
  - Scored via regex NLP hook analysis:
    - *Urgency & Problem Pain* (risk, hack, leak, threat, sore, stiff)
    - *Financial Arbitrage* (70% off, free trial, save $, cheap)
    - *Friction Elimination* (one tap, 10 seconds, automatic, simple)
    - *Performance & Results* (relief, fast, wake up, proven)
    - *Versus / Comparison* (vs, alternative, review, test)
    - *Numeric Proof* (percentages, dollar amounts, device limits)
- **Scale & Reach (0–30 pts)**:
  - EU verified reach / impressions upper bounds.
  - Publisher frequency scale (advertisers running the creative across 5+ ad variants receive multi-ad scaling bonuses).

### 2. Metric Calculations
- **Estimated CTR**:
  $$\text{CTR} = 0.95\% + \left(\frac{\text{CopyScore}}{30}\right) \times 1.45\% + \left(\frac{\text{LongevityScore}}{40}\right) \times 0.85\%$$
  - Top tier ads achieve $2.5\% - 3.25\%$ CTR.
  - Average ads achieve $1.4\% - 1.8\%$ CTR.
  - Flop ads achieve $< 1.1\%$ CTR.
### 2. Metric Calculations & Ground-Truth Separation

The engine strictly distinguishes **Verified Meta Ground-Truth** from **Algorithmic Heuristic Estimates**:

#### A. Verified Ground Truth (Direct from Meta Graph API)
* **Status**: `ACTIVE` (ad is currently being delivered) vs `INACTIVE` (campaign stopped).
* **Active Flight Timeline**: Exact start date (`ad_delivery_start_time`), stop date (`ad_delivery_stop_time` or "Still Running"), and total active days.
* **Where the Ad is Active (Platforms)**: Facebook, Instagram, Messenger, Audience Network, Threads (from `publisher_platforms`).
* **Targeted Delivery & Languages**: Language codes and country targets.
* **Real EU Verified Reach**: `eu_total_reach` (Meta's verified count of unique users who saw the ad in the EU/EEA transparency repository).
* **Real Meta Impressions Range**: `impressions.lower_bound` to `impressions.upper_bound` (populated when Meta transparency data is available).

#### B. Algorithmic Estimates (Modeled Performance Heuristics)
> [!NOTE]
> Meta's public Ad Library **never** reveals private commercial advertiser click counts, exact dollar spend, or CTR for commercial affiliate offers. Those metrics are calculated using industry-standard modeling:

* **Estimated CTR**:
  $$\text{CTR} = 0.95\% + \left(\frac{\text{CopyScore}}{30}\right) \times 1.45\% + \left(\frac{\text{LongevityScore}}{40}\right) \times 0.85\%$$
  - Top tier ads achieve $2.2\% - 3.25\%$ CTR.
  - Average performers achieve $1.5\% - 2.0\%$ CTR.
  - Killed test duds achieve $< 1.2\%$ CTR.
* **Estimated CPC**:
  $$\text{CPC} = \frac{\text{Baseline CPM}}{(\text{CTR} \times 10)}$$
  *(Standardized against Tier 1 Meta average CPM of \$26.00)*.
* **Estimated Clicks**:
  $$\text{Estimated Clicks} = \text{Estimated Impressions} \times \left(\frac{\text{Estimated CTR}}{100}\right)$$
* **Estimated Global Impressions & Ad Spend**:
  - Derived from continuous flight duration multiplied by minimum daily budget pacing ($50–$250/day/ad set), or scaled from EU transparency reach ($1.3\times - 2.4\times$ frequency multiplier).

---

## Funnel Reconnaissance & Technical Fingerprinting

The engine automatically executes deep technical reconnaissance on any provided URL before querying Meta ads:

1. **HTTP Redirect Chain & Affiliate Parameter Harvester**:
   - Follows 301/302/307 redirects across up to 6 hops.
   - Extracts affiliate query parameters: `affiliate`, `aff`, `hop`, `vendor`, `tid`, `tracking_id`, `shield`, `hopid`, `offer_id`, `aff_id`, `vtid`.
   - Resolves cloaked, bit.ly, or shield links to their final landing destination.

2. **Tracking Pixel & Analytics Fingerprinting**:
   - Detects all tracking tags on the landing page:
     - **Meta Pixel IDs**: `fbq('init', '...')` & `connect.facebook.net/tr?id=...`
     - **Google Tag Manager**: `GTM-XXXXXX`
     - **Google Analytics**: `UA-XXXXX` & `G-XXXXXXXX`
     - **Google Ads Conversion Tags**: `AW-XXXXXXXXX`
     - **Microsoft Clarity**: `clarity.ms/tag/...`
     - **TikTok Pixels**: `ttq.load('...')`

3. **Video Infrastructure & Timed Buy-Button Reveals**:
   - Detects video player tech: `Vturb SmartPlayer (Converteai)`, `Wistia`, `Vidalytics`, `Vimeo`, `YouTube`.
   - Decodes JavaScript timed cart/buy-button delays (e.g., `displayHiddenElements(1251)` $\rightarrow$ 1,251s / ~20 min 51s delay).

4. **Direct Checkout Gateway Extraction**:
   - Extracts raw checkout links embedded in the page:
     - ClickBank pay links (`*.pay.clickbank.net/?cbitems=...`)
     - Stripe checkout (`buy.stripe.com/...`)
     - Shopify checkout endpoints
     - Digistore24 order links

5. **Infrastructure & Sister Subdomain Reconnaissance**:
   - Queries public DNS and Certificate Transparency logs (`HackerTarget` & `crt.sh`).
   - Maps hidden tracking domains, redirect subdomains, and sister bridge pages (e.g. `trk.`, `links.`, `mail.`, `go.`).

---

## Agent Workflow Instructions

When this skill is invoked:

1. **Check Input**:
   - Extract the URL or brand from the user request.
   - If missing, prompt the user for the affiliate link or merchant website.

2. **Execute Engine**:
   - Run `node ads/affiliate_spy_engine.js "<URL>"` using `run_command`.
   - The engine logs live queries and saves the full dossier to `ads/spy_results_<brand>.json`.

3. **Read & Synthesize Results**:
   - Read the generated JSON file.
   - Synthesize both the **Funnel Reconnaissance** and **Meta Ads Intelligence**.

4. **Deliver Structured Intelligence Dossier**:
   Always format your answer with:
   - **Executive Summary**: Network detected, target URL vs final destination, total ads found, active vs inactive count.
   - **Funnel & Technical Reconnaissance**:
     - Redirect Hops & affiliate tracking signatures (`shield`, `hopId`, `vendor`, etc.)
     - Tracking pixels detected (Meta Pixel, GTM, Google Ads, Clarity)
     - Video player technology & exact timed buy-button reveal delay (e.g. 20 min 51s)
     - Direct checkout links (e.g. ClickBank pay links)
     - Discovered subdomains & infrastructure
   - **Top Winning Creatives**:
     - **Score & Grade** (e.g. `76/100 [A (Highly Profitable Winner)]`)
     - **Publisher & Ad ID**: Page Name & Meta Ad Library ID
     - **Active Status & Flight Timeline**: `ACTIVE` vs `INACTIVE`, start date, stop date, total flight days
     - **Where Active (Platforms)**: Facebook, Instagram, Messenger, Audience Network
     - **Real Meta API Data**: EU verified reach or Meta transparency impression range
     - **Estimated Performance Metrics**: Estimated CTR, CPC, Clicks, Spend, and Global Impressions
     - **Headline, Link Caption & Body Snippet**
     - **Copy Hook Breakdown** (Triggers detected)
     - **Direct Meta Ad Library Link** (`https://www.facebook.com/ads/library/?id=...`)
   - **Actionable Cold Traffic Recommendation**:
     - What angle converts best.
     - Recommended ad format and bridge page blueprint.
