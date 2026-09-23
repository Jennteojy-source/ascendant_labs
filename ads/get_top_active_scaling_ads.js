#!/usr/bin/env node
/**
 * Discover Top Active & High-Impression Meta Ads for ClickBank Offers
 * Ascendant Labs
 * 
 * Filters specifically for active ads (currently running) with high verified reach
 * or continuous flight duration (proven scale).
 */

const fs = require('fs');
const path = require('path');
const { evaluateAdPerformance } = require('./affiliate_spy_engine');
const { traceRedirectChain } = require('./lib/funnel_inspector');
const { queryMetaArchive } = require('./lib/comparable_finder');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryActiveAdsForOffer(vendor, title, domainHint = '') {
  const cleanVendor = vendor.toLowerCase();
  const searchTerms = [cleanVendor];
  if (domainHint) searchTerms.push(domainHint);
  const cleanTitle = title.split('-')[0].split(':')[0].trim().toLowerCase();
  if (cleanTitle.length >= 4 && cleanTitle !== cleanVendor) searchTerms.push(cleanTitle);

  const adsMap = new Map();

  for (const term of searchTerms) {
    const res = await queryMetaArchive(term, { countries: ['US', 'CA', 'GB', 'AU'], status: 'ACTIVE', limit: 50 });
    const data = res.data || [];
    data.forEach(ad => {
      if (ad && ad.id && !ad.ad_delivery_stop_time && !adsMap.has(ad.id)) {
        adsMap.set(ad.id, ad);
      }
    });
    await sleep(250);
  }

  const rawAds = Array.from(adsMap.values());
  // Filter for genuine promotion
  const matched = rawAds.filter(ad => {
    const fullText = JSON.stringify(ad).toLowerCase();
    const matchesVendor = fullText.includes(cleanVendor);
    const matchesDomain = domainHint ? fullText.includes(domainHint) : false;
    const matchesTitle = cleanTitle.length >= 5 ? fullText.includes(cleanTitle) : false;
    return matchesVendor || matchesDomain || matchesTitle;
  });

  return matched;
}

async function main() {
  console.log(`========================================================================`);
  console.log(` 🚀 SCANNING FOR TOP ACTIVE, HIGH-IMPRESSION META ADS`);
  console.log(` Filtering: Active campaigns only | Proven scale / continuous flight`);
  console.log(`========================================================================\n`);

  // Target leading ClickBank offers across niches
  const targetPrograms = [
    { vendor: 'PURADROP', title: 'Puradrop', domain: 'puradrop.com' },
    { vendor: 'GENIUSWAVE', title: 'The Genius Wave', domain: 'thegeniuswave.com' },
    { vendor: 'YUSLEEP', title: 'YU Sleep', domain: 'getyusleep.com' },
    { vendor: 'ENREV', title: 'Energy Revolution System', domain: 'theenergyrevolution.net' },
    { vendor: 'FEMICORE', title: 'FemiCore', domain: 'getfemicore.com' },
    { vendor: 'BRAINSONGX', title: 'The Brain Song', domain: 'gobrainsong.com' },
    { vendor: 'PRODENTIM', title: 'ProDentim', domain: 'prodentim.com' },
    { vendor: 'TEDSPLANS', title: 'TedsWoodworking', domain: 'tedplansdiy.com' },
    { vendor: 'DERILAERGO', title: 'Derila Memory Foam Pillow', domain: 'derila-ergo.com' },
    { vendor: 'GLUCOBERRY', title: 'GlucoBerry', domain: 'glucoberry.com' },
    { vendor: 'NEUROQUIET', title: 'NeuroQuiet', domain: 'neuroquiet.com' },
    { vendor: 'ALPILEAN', title: 'Alpilean', domain: 'alpilean.com' },
    { vendor: 'KERASSENT', title: 'Kerassentials', domain: 'kerassentials.com' },
    { vendor: 'MITOPURE', title: 'MitoPure', domain: 'getmitopure.com' },
    { vendor: 'LIVPUREX', title: 'Liv Pure', domain: 'liv-pure.org' }
  ];

  const allActiveAds = [];

  for (let i = 0; i < targetPrograms.length; i++) {
    const prog = targetPrograms[i];
    console.log(`[${i + 1}/${targetPrograms.length}] Scanning active ads for: ${prog.title} (${prog.vendor})...`);

    const ads = await queryActiveAdsForOffer(prog.vendor, prog.title, prog.domain);
    console.log(`    Found ${ads.length} active ads currently running.`);

    // Publisher count
    const pubCounts = {};
    ads.forEach(a => pubCounts[a.page_name] = (pubCounts[a.page_name] || 0) + 1);

    ads.forEach(rawAd => {
      const evaluated = evaluateAdPerformance(rawAd, pubCounts[rawAd.page_name] || 1);
      evaluated.offer_vendor = prog.vendor;
      evaluated.offer_title = prog.title;
      evaluated.offer_domain = prog.domain;
      allActiveAds.push(evaluated);
    });
  }

  // Filter for HIGH IMPRESSIONS & LONGEVITY:
  // Must be ACTIVE, and have either:
  // - Verified EU reach >= 100 OR
  // - Continuous active flight >= 5 days OR
  // - High score >= 50
  const highScaleActiveAds = allActiveAds.filter(a => {
    const reach = a.verified_meta_data.real_eu_reach || 0;
    const flightDays = a.flight_dates.duration_days || 0;
    return a.is_active && (reach >= 50 || flightDays >= 5 || a.effectiveness_score >= 50);
  });

  // Sort by scale: combination of reach, flight days, and score
  highScaleActiveAds.sort((a, b) => {
    const reachA = a.verified_meta_data.real_eu_reach || 0;
    const reachB = b.verified_meta_data.real_eu_reach || 0;
    const flightA = a.flight_dates.duration_days || 0;
    const flightB = b.flight_dates.duration_days || 0;
    
    // Priority: high reach first, then long flight
    if (reachA !== reachB) return reachB - reachA;
    if (flightA !== flightB) return flightB - flightA;
    return b.effectiveness_score - a.effectiveness_score;
  });

  console.log(`\n========================================================================`);
  console.log(` 🏆 FOUND ${highScaleActiveAds.length} ACTIVE HIGH-IMPRESSION ADS!`);
  console.log(`========================================================================\n`);

  highScaleActiveAds.slice(0, 15).forEach((ad, i) => {
    console.log(`[#${i + 1}] Score: ${ad.effectiveness_score}/100 [${ad.grade}] | Offer: ${ad.offer_title} (${ad.offer_vendor})`);
    console.log(`     Publisher:     ${ad.page_name} (Ad ID: ${ad.id})`);
    console.log(`     Status:        ${ad.status} [${ad.flight_dates.duration_days} days running: ${ad.flight_dates.start} -> Present]`);
    if (ad.verified_meta_data.real_eu_reach) {
      console.log(`     Real EU Reach: ${ad.verified_meta_data.real_eu_reach.toLocaleString()} verified users (Meta EU Transparency)`);
    }
    console.log(`     Est. Metrics:  CTR: ${ad.estimated_metrics.estimated_ctr} | CPC: ${ad.estimated_metrics.estimated_cpc} | Clicks: ${ad.estimated_metrics.estimated_clicks}`);
    console.log(`     Est. Scale:    ${ad.estimated_metrics.estimated_global_impressions} global impr | Spend: ${ad.estimated_metrics.estimated_spend}`);
    console.log(`     Headline:      "${ad.headline || 'N/A'}"`);
    console.log(`     Body Snippet:  "${ad.body_snippet}..."`);
    console.log(`     Triggers:      ${ad.triggers.join(', ') || 'General'}`);
    console.log(`     Ad Library:    ${ad.ad_library_url}\n`);
  });

  // Export JSON
  const jsonPath = path.resolve(__dirname, 'active_high_impression_ads.json');
  fs.writeFileSync(jsonPath, JSON.stringify(highScaleActiveAds, null, 2), 'utf8');
  console.log(`Saved ${highScaleActiveAds.length} active scaling ads to: ${jsonPath}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
