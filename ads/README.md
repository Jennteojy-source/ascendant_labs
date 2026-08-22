# 📁 Ascendant Labs Ads & Creative Asset Directory

This directory contains all Meta Ad campaigns, prompts, creative assets, and analytics tooling for Ascendant Labs / ShieldNet Privacy VPN affiliate marketing.

---

## 🗂️ Directory Structure

```text
ads/
├── README.md                           # This index file
├── meta_marketing_api.js               # Meta Graph API Campaign & Funnel Analyzer
├── prompts/
│   ├── ctwa_funnel/
│   │   └── ctwa_mba_master_playbook.md # ⭐ Master Blueprint for Click-to-WhatsApp Ads + Meta Business AI (2026)
│   └── website_funnel/
│       └── scan_funnel_web.md          # Website Direct Traffic Scan Funnel Guide
├── creatives/
│   ├── ctwa/                           # ⭐ Winning CTWA Ad Creative (No on-image CTA)
│   │   └── variant-7-ai-browsing-protection.jpg
│   ├── scan/                           # Website Editorial UI scan creatives (variant-1 to variant-4)
│   ├── warm/                           # Lifestyle & editorial warm privacy graphics
│   ├── express_vpn/                    # ExpressVPN creative assets
│   ├── quiz/                           # Quiz funnel creative assets
│   └── misc/                           # Miscellaneous banners & graphics
└── logos/
    ├── ascendant_labs_logo_warm.png    # Warm Ascendant Labs brand mark
    ├── ascendant_labs_logo_icon.png    # Shield icon badge
    └── ascendant_labs_profile_logo.png # WhatsApp business profile avatar
```

---

## 🚀 Two Distinct Ad Funnels

### 1. Click-to-WhatsApp (CTWA) Funnel (`ads/prompts/ctwa_funnel/`)
- **Traffic Destination**: Native WhatsApp Chat with **Meta Business AI (MBA)**.
- **Winning Creative**: [`variant-7-ai-browsing-protection.jpg`](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/ads/creatives/ctwa/variant-7-ai-browsing-protection.jpg) — Real handheld smartphone showing WhatsApp AI risk diagnosis with clean headline: *"IS YOUR BROWSING REALLY PROTECTED?"*.
- **Creative Rule**: Clean editorial UI / realistic handheld screen with **NO on-image CTA buttons** (Meta natively renders the `Send WhatsApp Message` bar underneath).
- **Targeting**: High-ARPU & High-Willingness-to-Pay countries (UK, Germany, Spain, Italy, Netherlands, Singapore, Australia, UAE, Saudi Arabia, US/Canada). Low-ARPU countries (India, Pakistan, etc.) are excluded.
- **Funnel Mechanics**: User taps native `Send WhatsApp Message` with pre-filled icebreaker -> MBA agent conducts SPIN discovery -> Optional 1-tap connection scan -> Agent sends interactive native product card (`SEND_CTA_URL`) with tracked affiliate link.
- **Master Guide**: [ctwa_mba_master_playbook.md](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/ads/prompts/ctwa_funnel/ctwa_mba_master_playbook.md)

### 2. Website Scan Funnel (`ads/prompts/website_funnel/`)
- **Traffic Destination**: Web Landing Page (`https://ascendantlabs.co/nordvpn/scan` or `https://ascendantlabs.co/scan_v2`).
- **Funnel Mechanics**: User taps `Learn More` -> Lands on browser diagnostic scanner -> Sees live IP/ISP/Location exposure -> Taps `Protect Connection` affiliate CTA button.
- **Guide**: [scan_funnel_web.md](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/ads/prompts/website_funnel/scan_funnel_web.md)

---

## 🛠️ CLI Utilities & Agent Operations

### Sync Meta Business AI Skills & FAQs to WhatsApp Number:
```bash
node functions/scripts/sync_mba.js
# Or sync skills only:
node functions/scripts/sync_mba.js --skills
```

### Run Automated Multi-Turn MBA Agent Evaluation:
```bash
node functions/scripts/eval_mba.js
# Or test a single scenario:
node functions/scripts/eval_mba.js --scenario=vpn-beginner
```

### Run Daily Ad x WhatsApp AI Closed-Loop Harness:
```bash
# Evaluate yesterday's ads vs WhatsApp agent conversations:
npm run harness
# Or run with custom timeframes / filters:
node ads/daily_harness.js --days=1
node ads/daily_harness.js --date-preset=last_7d --campaign="Nord"
node ads/daily_harness.js --dry-run
```
*Reports are saved automatically to `ads/reports/daily_eval_YYYY_MM_DD.md`.*

### Analyze Meta Ads Performance & Conversion Metrics:
```bash
node ads/meta_marketing_api.js --date-preset last_7d
```
# Or run with custom timeframes / filters:
node ads/daily_harness.js --days=1
node ads/daily_harness.js --date-preset=last_7d --campaign="Nord"
node ads/daily_harness.js --dry-run
```
*Reports are saved automatically to `ads/reports/daily_eval_YYYY_MM_DD.md`.*

### Analyze Meta Ads Performance & Conversion Metrics:
```bash
node ads/meta_marketing_api.js --date-preset last_7d
```
