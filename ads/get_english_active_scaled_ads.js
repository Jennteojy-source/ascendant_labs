#!/usr/bin/env node
/**
 * Discover Top Active High-Impression Meta Ads in English-Speaking Markets
 * Target Geos: US, CA, GB (UK), AU, NZ
 * Ascendant Labs
 */

const fs = require('fs');
const path = require('path');
const { evaluateAdPerformance } = require('./affiliate_spy_engine');
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

// Search across Tier-1 English countries specifically
async function queryEnglishActiveAds(vendor, title, domain) {
  const cleanVendor = vendor.toLowerCase();
  const searchTerms = [cleanVendor];
  if (domain) searchTerms.push(domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  
  // Also clean the product title
  const cleanTitle = title.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').split('-')[0].split(':')[0].trim().toLowerCase();
  if (cleanTitle.length >= 4 && cleanTitle !== cleanVendor) {
    searchTerms.push(cleanTitle);
  }

  const adsMap = new Map();

  for (const term of searchTerms) {
    const res = await queryMetaArchive(term, { countries: ['US', 'CA', 'GB', 'AU', 'NZ'], status: 'ACTIVE', limit: 50 });
    const data = res.data || [];
    
    data.forEach(ad => {
      if (ad && ad.id && !ad.ad_delivery_stop_time && !adsMap.has(ad.id)) {
        adsMap.set(ad.id, ad);
      }
    });
    await sleep(200);
  }

  const rawAds = Array.from(adsMap.values());
  // Verify relevance
  const relevantAds = rawAds.filter(ad => {
    const fullText = JSON.stringify(ad).toLowerCase();
    const matchesVendor = fullText.includes(cleanVendor);
    const matchesDomain = domain ? fullText.includes(domain.split('.')[0]) : false;
    const matchesTitle = cleanTitle.length >= 5 ? fullText.includes(cleanTitle) : false;
    return matchesVendor || matchesDomain || matchesTitle;
  });

  return relevantAds;
}

async function run() {
  console.log(`========================================================================`);
  console.log(` 🇬🇧 🇺🇸 SCANNING TOP ACTIVE SCALED ADS IN ENGLISH-SPEAKING MARKETS`);
  console.log(` Target Countries: United States, United Kingdom, Canada, Australia, New Zealand`);
  console.log(` Filter: Status = ACTIVE | Proven Scale / Long Flight Days / High Impressions`);
  console.log(`========================================================================\n`);

  // Load top ClickBank marketplace offers
  const cbFile = path.resolve(__dirname, 'clickbank_marketplace_full.json');
  const allOffers = JSON.parse(fs.readFileSync(cbFile, 'utf8'));

  // Select top high-converting offers with English appeal
  const topTargetVendors = [
    'PRODENTIM',
    'TEDSPLANS',
    'DERILAERGO',
    'YUSLEEP',
    'BRAINSONGX',
    'FEMICORE',
    'ENREV',
    'GENIUSWAVE',
    'GENIUSSONG',
    'PURADROP',
    'NUMEROLOG',
    'JOINTGENESIS',
    'WATERFREEDOM',
    'PROSTAVIVE',
    'ALLDAYSLIM',
    'ALPILEAN',
    'GLUCOBERRY',
    'NEUROQUIET'
  ];

  const selectedOffers = allOffers.filter(o => topTargetVendors.includes(o.vendor.toUpperCase()));
  // Also add any vendor in top 15 gravity
  allOffers.slice(0, 15).forEach(o => {
    if (!selectedOffers.some(s => s.vendor === o.vendor)) {
      selectedOffers.push(o);
    }
  });

  console.log(`Auditing ${selectedOffers.length} leading ClickBank offers across US, CA, GB, AU, NZ...\n`);

  const allActiveAds = [];

  for (let i = 0; i < selectedOffers.length; i++) {
    const offer = selectedOffers[i];
    let domainHint = '';
    if (offer.affiliate_tools_url) {
      try {
        domainHint = new URL(offer.affiliate_tools_url).hostname.replace(/^www\./, '');
      } catch(e) {}
    }

    console.log(`[${i+1}/${selectedOffers.length}] Querying ${offer.vendor} (${offer.title.slice(0, 35)}...)`);
    const ads = await queryEnglishActiveAds(offer.vendor, offer.title, domainHint);
    console.log(`    Found ${ads.length} active ads.`);

    const pubCounts = {};
    ads.forEach(a => pubCounts[a.page_name] = (pubCounts[a.page_name] || 0) + 1);

    ads.forEach(rawAd => {
      const evaluated = evaluateAdPerformance(rawAd, pubCounts[rawAd.page_name] || 1);
      evaluated.offer_vendor = offer.vendor;
      evaluated.offer_title = offer.title;
      evaluated.offer_gravity = offer.gravity;
      evaluated.offer_cvr = offer.cvr;
      evaluated.offer_epc = offer.epc;
      evaluated.offer_payout = offer.avg_payout;
      evaluated.sales_page_url = offer.sales_page_url;
      evaluated.affiliate_tools_url = offer.affiliate_tools_url;
      allActiveAds.push(evaluated);
    });
  }

  console.log(`\nTotal Active Ads Retrieved across English Geos: ${allActiveAds.length}`);

  // Filter for proven high scale / high impressions:
  // Must be ACTIVE and:
  // 1. Continuous flight >= 7 days (or 14+ days for mega winners) OR
  // 2. Verified EU reach >= 100 (if dual-targeted) OR
  // 3. Effectiveness Score >= 55
  const scaledAds = allActiveAds.filter(a => {
    const days = a.flight_dates.duration_days || 0;
    const reach = a.verified_meta_data.real_eu_reach || 0;
    return a.is_active && (days >= 7 || reach >= 100 || a.effectiveness_score >= 60);
  });

  // Sort primarily by Continuous Active Days (Proof of Profit & Scale in English geos), then by effectiveness score
  scaledAds.sort((a, b) => {
    const daysA = a.flight_dates.duration_days || 0;
    const daysB = b.flight_dates.duration_days || 0;
    if (daysB !== daysA) return daysB - daysA;
    return b.effectiveness_score - a.effectiveness_score;
  });

  console.log(`High-Scale Proven Active Ads Filtered: ${scaledAds.length}`);

  // Save to JSON
  const outJson = path.resolve(__dirname, 'english_active_high_impression_ads.json');
  fs.writeFileSync(outJson, JSON.stringify(scaledAds, null, 2), 'utf8');
  console.log(`Saved detailed JSON to: ${outJson}`);

  // Print top 10 winners
  console.log(`\n========================================================================`);
  console.log(` 🏆 TOP ACTIVE ENGLISH MARKET WINNERS (SORTED BY LONGEVITY & SCALE)`);
  console.log(`========================================================================\n`);

  scaledAds.slice(0, 12).forEach((ad, idx) => {
    console.log(`${idx + 1}. [${ad.offer_vendor}] ${ad.offer_title}`);
    console.log(`   Page:           ${ad.page_name} (ID: ${ad.page_id})`);
    console.log(`   Active Since:   ${ad.flight_dates.start} (${ad.flight_dates.duration_days} CONTINUOUS DAYS RUNNING)`);
    console.log(`   Est. Volume:    ${ad.estimated_metrics.estimated_global_impressions} impressions | Est. Spend: ${ad.estimated_metrics.estimated_spend}`);
    console.log(`   Ad Library URL: ${ad.ad_library_url}`);
    console.log(`   Headline:       "${ad.headline || 'N/A'}"`);
    console.log(`   Copy Hook:      "${ad.body_snippet || 'N/A'}..."`);
    console.log(`   Copy Triggers:  ${(ad.triggers || []).join(', ') || 'Direct'}`);
    console.log(`   Grade / Score:  ${ad.grade} (${ad.effectiveness_score}/100)`);
    console.log(`------------------------------------------------------------------------`);
  });
}

run().catch(console.error);
