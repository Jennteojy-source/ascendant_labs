---
name: video-ad
description: Quick shortcut to run the Meta Ads Video AI Generation Skill. Crawls a product website, downloads reference images, analyzes competitor ads via Facebook Ads Library API, and generates production-ready Video AI prompts (Runway Gen-3, Kling, Luma, Sora) with voice-overs and captions.
---

# Video Ad Skill (Short Alias)

This skill provides a fast shortcut for the **Meta Ads Video AI Prompt & Creative Generation Engine**.

For full documentation, visual guidelines, and prompt specifications, see [meta-video-ad-generator skill](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/.agents/skills/meta-video-ad-generator/SKILL.md).

## Quick Run

```bash
node ads/video_ad_generator.js "<PRODUCT_WEBSITE_URL>" [options]
```

Or:

```bash
npm run video:ad -- "<PRODUCT_WEBSITE_URL>" [options]
```

### Options
- `-u, --url`: Product website URL
- `-p, --max-pages`: Max internal links to crawl (default: `6`)
- `-i, --max-images`: Max reference images to download (default: `8`)
- `-c, --countries`: Target country codes (default: `US,GB,CA,AU`)
- `-o, --output`: Custom output campaign directory
- `--skip-spy`: Skip Meta Ads Library API competitor query
