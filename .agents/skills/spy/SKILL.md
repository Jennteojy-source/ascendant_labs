---
name: spy
description: Quick shortcut to run the Affiliate Ad Spy & Performance Intelligence Engine. Discovers Meta ads promoting any affiliate program, tracking link, or product domain, and estimates CTR, CPC, impressions, and ad spend.
---

# Spy Skill (Short Alias)

This skill provides a quick shortcut for the **Affiliate Ad Spy & Performance Intelligence Engine**.

For full documentation and methodologies, see [affiliate-ad-spy skill](file:///Users/kirkzhang/Documents/Antigravity/ascendant_labs/.agents/skills/affiliate-ad-spy/SKILL.md).

## Quick Run

```bash
node ads/affiliate_spy_engine.js "<AFFILIATE_OR_PRODUCT_URL>" [options]
```

Or:

```bash
npm run spy -- "<AFFILIATE_OR_PRODUCT_URL>" [options]
```

### Options
- `-u, --url`: Affiliate tracking link or product domain
- `-c, --countries`: Comma-separated country codes (default: `US,GB,CA,AU`)
- `-s, --status`: `ALL`, `ACTIVE`, `INACTIVE` (default: `ALL`)
- `-l, --limit`: Result limit per query vector (default: `50`)
- `-o, --output`: Custom output JSON path
- `--skip-funnel`: Skip HTTP redirect tracing and tech stack inspection
