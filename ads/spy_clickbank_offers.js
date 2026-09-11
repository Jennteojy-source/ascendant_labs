#!/usr/bin/env node
/**
 * ClickBank Top Offers -> Meta Ad Cross-Intelligence Engine
 * Ascendant Labs
 * 
 * Takes the extracted ClickBank marketplace offers, resolves their merchant
 * sales pages, queries Meta's Ad Library for all live & historical campaigns,
 * and correlates marketplace metrics (Gravity, CVR, EPC) with real-world Meta ad performance.
 * 
 * Usage:
 *   node ads/spy_clickbank_offers.js --top 10
 *   node ads/spy_clickbank_offers.js --top 15
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { traceRedirectChain } = require('./lib/funnel_inspector');
const { evaluateAdPerformance, parseAffiliateInput } = require('./affiliate_spy_engine');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    });
  }
}
loadEnv();

const token = process.env.USER_TOKEN;
if (!token) {
  console.error("Error: USER_TOKEN not found in functions/.env");
  process.exit(1);
}

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 12000 }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
      });
    }).on('error', () => resolve({})).on('timeout', () => resolve({}));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchMetaAds(searchTerms, countries = ['US', 'CA', 'GB', 'AU'], limit = 30) {
  const fields = [
    'id',
    'page_id',
    'page_name',
    'ad_creation_time',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'eu_total_reach',
    'impressions',
    'ad_snapshot_url',
    'ad_creative_bodies',
    'ad_creative_link_captions',
    'ad_creative_link_titles',
    'publisher_platforms',
    'languages'
  ].join(',');

  const adsMap = new Map();

  for (const term of searchTerms) {
    if (!term || term.trim().length < 3) continue;
    const params = new URLSearchParams({
      access_token: token,
      ad_reached_countries: JSON.stringify(countries),
      ad_active_status: 'ALL',
      search_terms: term.trim(),
      fields: fields,
      limit: limit.toString()
    });

    const url = `https://graph.facebook.com/v20.0/ads_archive?${params.toString()}`;
    const res = await fetchJson(url);
    const data = res.data || [];
    data.forEach(ad => {
      if (ad && ad.id && !adsMap.has(ad.id)) {
        adsMap.set(ad.id, ad);
      }
    });
    await sleep(250); // slight pause to respect rate limits
  }

  return Array.from(adsMap.values());
}

async function main() {
  const args = process.argv.slice(2);
  let topCount = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) {
      topCount = parseInt(args[++i], 10);
    }
  }

  const marketplaceFile = path.resolve(__dirname, 'clickbank_marketplace_full.json');
  if (!fs.existsSync(marketplaceFile)) {
    console.error("Error: clickbank_marketplace_full.json not found. Run scrape_clickbank_marketplace.js first.");
    process.exit(1);
  }

  const allOffers = JSON.parse(fs.readFileSync(marketplaceFile, 'utf8'));
  const targetOffers = allOffers.slice(0, topCount);

  console.log(`========================================================================`);
  console.log(` 🕵️‍♂️ CLICKBANK TOP OFFERS -> META AD CROSS-INTELLIGENCE AUDIT`);
  console.log(` Analyzing Top ${targetOffers.length} ClickBank Marketplace Programs`);
  console.log(` Correlating Gravity, CVR & EPC with Live Meta Ad Campaigns`);
  console.log(`========================================================================\n`);

  const report = [];

  for (let i = 0; i < targetOffers.length; i++) {
    const offer = targetOffers[i];
    console.log(`[${i + 1}/${targetOffers.length}] Auditing: ${offer.title} (${offer.vendor}) | Gravity: ${offer.gravity}`);

    // 1. Resolve merchant destination domain
    let merchantDomain = '';
    let merchantUrl = offer.sales_page_url;

    if (!merchantUrl || merchantUrl.includes('hop.clickbank.net')) {
      const hopUrl = `https://hop.clickbank.net/?affiliate=zzzzz&vendor=${offer.vendor}`;
      try {
        const traceRes = await traceRedirectChain(hopUrl, 3);
        merchantUrl = traceRes.final_destination || hopUrl;
      } catch (e) {
        merchantUrl = hopUrl;
      }
    }

    try {
      const u = new URL(merchantUrl);
      merchantDomain = u.hostname.toLowerCase().replace(/^www\./, '');
    } catch(e) {
      merchantDomain = offer.vendor.toLowerCase();
    }

    console.log(`    Resolved Sales Domain: ${merchantDomain} (${merchantUrl})`);

    // 2. Build search vectors
    const cleanVendor = offer.vendor.toLowerCase();
    const brandName = merchantDomain.split('.')[0].replace(/[^a-z0-9]/gi, '');
    const searchTerms = [
      merchantDomain,
      cleanVendor,
      brandName,
      `${cleanVendor} review`,
      `${brandName} deal`
    ].filter(t => t && t.length >= 3);

    console.log(`    Querying Meta Ads Archive for vectors: ${[...new Set(searchTerms)].join(', ')}...`);

    // 3. Query Meta Ads Archive
    const rawAds = await searchMetaAds([...new Set(searchTerms)], ['US', 'CA', 'GB', 'AU'], 25);

    // Filter relevant ads
    const matchedAds = rawAds.filter(ad => {
      const fullText = JSON.stringify(ad).toLowerCase();
      const matchesDomain = fullText.includes(merchantDomain);
      const matchesVendor = fullText.includes(cleanVendor);
      const matchesBrand = brandName.length >= 4 && fullText.includes(brandName);
      return matchesDomain || matchesVendor || matchesBrand;
    });

    console.log(`    Found ${rawAds.length} candidate ads -> ${matchedAds.length} verified offer ads.`);

    // Publisher frequency
    const pubCounts = {};
    matchedAds.forEach(a => pubCounts[a.page_name] = (pubCounts[a.page_name] || 0) + 1);

    // Evaluate ads
    const evaluatedAds = matchedAds.map(ad => evaluateAdPerformance(ad, pubCounts[ad.page_name] || 1));
    evaluatedAds.sort((a, b) => b.effectiveness_score - a.effectiveness_score);

    const activeAds = evaluatedAds.filter(a => a.is_active);
    const maxFlightDays = evaluatedAds.reduce((max, a) => Math.max(max, a.flight_dates.duration_days), 0);
    const topCreative = evaluatedAds[0] || null;

    // Determine Meta Traffic Scaling Status
    let scalingVerdict = 'No Meta Ads Detected (Primarily Email/YouTube/SEO Traffic)';
    if (activeAds.length >= 5 || maxFlightDays >= 14) {
      scalingVerdict = '🔥 Aggressively Scaling on Meta (High Continuous Spend)';
    } else if (activeAds.length > 0 || maxFlightDays >= 4) {
      scalingVerdict = '⚡ Moderately Active on Meta (Testing & Steady Run)';
    } else if (evaluatedAds.length > 0) {
      scalingVerdict = '💤 Historical Meta Campaigns (Currently Inactive / Paused)';
    }

    const offerIntel = {
      clickbank_rank: offer.rank || (i + 1),
      vendor: offer.vendor,
      title: offer.title,
      category: offer.category,
      gravity: offer.gravity,
      cvr: offer.cvr,
      epc: offer.epc,
      avg_payout: offer.avg_payout,
      merchant_domain: merchantDomain,
      sales_page_url: merchantUrl,
      affiliate_tools_url: offer.affiliate_tools_url,
      contact: offer.contact_email || offer.contact_telegram || null,
      meta_ads: {
        total_discovered: evaluatedAds.length,
        active_count: activeAds.length,
        inactive_count: evaluatedAds.length - activeAds.length,
        longest_flight_days: maxFlightDays,
        scaling_verdict: scalingVerdict,
        top_publishers: Object.entries(pubCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
        top_creative: topCreative ? {
          score: topCreative.effectiveness_score,
          grade: topCreative.grade,
          status: topCreative.status,
          duration_days: topCreative.flight_dates.duration_days,
          publisher: topCreative.page_name,
          headline: topCreative.headline,
          body_snippet: topCreative.body_snippet,
          triggers: topCreative.triggers,
          real_eu_reach: topCreative.verified_meta_data.real_eu_reach,
          est_ctr: topCreative.estimated_metrics.estimated_ctr,
          est_cpc: topCreative.estimated_metrics.estimated_cpc,
          est_clicks: topCreative.estimated_metrics.estimated_clicks,
          est_spend: topCreative.estimated_metrics.estimated_spend,
          ad_library_url: topCreative.ad_library_url
        } : null
      }
    };

    report.push(offerIntel);

    console.log(`    Verdict: ${scalingVerdict}`);
    if (topCreative) {
      console.log(`    Top Creative: [${topCreative.grade}] "${topCreative.headline || topCreative.body_snippet.substring(0, 40)}..."`);
      console.log(`    Publisher: ${topCreative.page_name} | Est CTR: ${topCreative.estimated_metrics.est_ctr || topCreative.estimated_metrics.estimated_ctr} | Flight: ${topCreative.flight_dates.duration_days} days\n`);
    } else {
      console.log(`\n`);
    }

    await sleep(400);
  }

  // 1. Export JSON
  const jsonPath = path.resolve(__dirname, 'clickbank_meta_ad_intelligence.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`✅ Saved complete intelligence report to JSON: ${jsonPath}`);

  // 2. Export Markdown Report
  let md = `# ClickBank Top Offers vs. Meta Ads Performance Intelligence\n\n`;
  md += `*Audited Date: ${new Date().toISOString().split('T')[0]}*\n`;
  md += `*Total Offers Audited: ${report.length}*\n\n`;
  md += `This report cross-references live **ClickBank Marketplace metrics** (Gravity, CVR, EPC) with **Meta Ad Library campaigns** to reveal which offers are genuinely scaling on Facebook/Instagram cold traffic versus those running primarily on private email lists.\n\n`;

  md += `## Executive Cross-Analysis Table\n\n`;
  md += `| # | Vendor | Offer Title | Gravity | EPC | Meta Ads Total | Active Ads | Max Flight | Meta Scaling Verdict |\n`;
  md += `|:---:|:---|:---|:---:|:---:|:---:|:---:|:---:|:---|\n`;

  report.forEach(o => {
    md += `| **${o.clickbank_rank}** | \`${o.vendor}\` | ${o.title.replace(/\|/g, '-')} | **${o.gravity}** | ${o.epc} | ${o.meta_ads.total_discovered} | **${o.meta_ads.active_count}** | ${o.meta_ads.longest_flight_days}d | ${o.meta_ads.scaling_verdict} |\n`;
  });

  md += `\n---\n\n## Deep-Dive: Winning Creatives & Ad Performance per Offer\n\n`;

  report.forEach(o => {
    md += `### ${o.clickbank_rank}. ${o.title} (\`${o.vendor}\`)\n\n`;
    md += `- **ClickBank Metrics**: Gravity: **${o.gravity}** | CVR: \`${o.cvr}\` | EPC: \`${o.epc}\` | Avg Payout: **$${(o.avg_payout || 0).toFixed(2)}**\n`;
    md += `- **Sales Page (Merchant)**: [${o.merchant_domain}](${o.sales_page_url})\n`;
    md += `- **Affiliate JV / Tools Page**: ${o.affiliate_tools_url ? `[Affiliate JV Page](${o.affiliate_tools_url})` : 'N/A'}\n`;
    md += `- **Affiliate Contact**: ${o.contact || 'N/A'}\n`;
    md += `- **Meta Ad Volume**: ${o.meta_ads.total_discovered} ads found (${o.meta_ads.active_count} active)\n`;
    md += `- **Traffic Verdict**: ${o.meta_ads.scaling_verdict}\n\n`;

    if (o.meta_ads.top_creative) {
      const tc = o.meta_ads.top_creative;
      md += `#### Top Performing Creative:\n`;
      md += `* **Publisher / Fan Page**: **${tc.publisher}**\n`;
      md += `* **Score & Grade**: ${tc.score}/100 [${tc.grade}]\n`;
      md += `* **Status & Flight**: \`${tc.status}\` (${tc.duration_days} days continuous run)\n`;
      if (tc.real_eu_reach) md += `* **Real EU Transparency Reach**: **${tc.real_eu_reach.toLocaleString()}** verified users\n`;
      md += `* **Estimated Metrics**: CTR: **${tc.est_ctr}** | CPC: **${tc.est_cpc}** | Est. Clicks: **${tc.est_clicks}** | Est. Spend: **${tc.est_spend}**\n`;
      md += `* **Headline**: "${tc.headline || 'N/A'}"\n`;
      md += `* **Copy Hook Snippet**: "${tc.body_snippet}..."\n`;
      md += `* **NLP Psychological Triggers**: ${tc.triggers.join(', ') || 'General'}\n`;
      md += `* **Ad Library Link**: [View on Meta Ad Library](${tc.ad_library_url})\n\n`;
    } else {
      md += `*No direct Meta ads detected for this domain. Advertisers for this offer likely rely on email newsletters, YouTube pre-rolls, native advertorials, or cloaked bridge domains.*\n\n`;
    }
    md += `---\n\n`;
  });

  const mdPath = path.resolve(__dirname, 'clickbank_meta_ad_intelligence.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`✅ Saved complete intelligence dossier to Markdown: ${mdPath}\n`);

  console.log(`========================================================================`);
  console.log(` 🎉 AUDIT COMPLETE! Full cross-intelligence report generated.`);
  console.log(`========================================================================`);
}

main().catch(err => {
  console.error("Fatal error during ClickBank Meta cross audit:", err);
  process.exit(1);
});
