/**
 * Meta Ad Library Deep Researcher & Hook Extractor
 * Ascendant Labs / Meta Video Ad Generator
 * 
 * Queries Meta Graph API (ads_archive) to reverse-engineer live winning ads,
 * extract 3-second video hooks, copy angles, and creative inspirations.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}
loadEnv();

const USER_TOKEN = process.env.USER_TOKEN || process.env.META_ACCESS_TOKEN || process.env.CAPI_ACCESS_TOKEN;

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: { message: 'JSON parse error: ' + e.message } });
        }
      });
    }).on('error', (err) => resolve({ error: { message: err.message } }))
      .on('timeout', () => resolve({ error: { message: 'Request timeout' } }));
  });
}

/**
 * Categorize video hook archetype from ad text
 */
function classifyHookArchetype(text = '') {
  const lower = text.toLowerCase();
  if (/\b(stop|don't|never|mistake|worst|warning|avoid)\b/i.test(lower)) {
    return 'Negative Friction / Warning Pattern Interrupt';
  }
  if (/\b(secret|nobody tells you|didn't know|hidden|truth|why)\b/i.test(lower)) {
    return 'Curiosity Gap / Hidden Secret Hook';
  }
  if (/\b(my husband|i tried|after 30 days|i was skeptical|finally)\b/i.test(lower)) {
    return 'Authentic UGC Personal Story / Relatable Struggle';
  }
  if (/\b(vs|alternative|compared to|switch|better than|ditch)\b/i.test(lower)) {
    return 'Direct Comparison / Superior Alternative Hook';
  }
  if (/\b(hack|10 seconds|one tap|routine|habit|morning)\b/i.test(lower)) {
    return 'Quick Daily Habit / Effortless Routine Hook';
  }
  return 'Direct Value & Problem-Solution Hook';
}

/**
 * Deep Research on Facebook Ads Library via API
 */
async function researchCompetitorMetaAds(brandName, searchKeywords = [], options = {}) {
  const countries = options.countries || ['US', 'GB', 'CA', 'AU'];
  const limitPerTerm = options.limitPerTerm || 30;

  console.log(`\n========================================================================`);
  console.log(` 🕵️‍♂️ FACEBOOK ADS LIBRARY DEEP MARKET RESEARCH`);
  console.log(` Brand Target:  ${brandName}`);
  console.log(` Search Terms:  ${searchKeywords.join(', ')}`);
  console.log(` Countries:     ${countries.join(', ')}`);
  console.log(`========================================================================\n`);

  if (!USER_TOKEN) {
    console.warn(`⚠️ Warning: USER_TOKEN / META_ACCESS_TOKEN not configured in functions/.env`);
    return {
      success: false,
      error: 'Missing Meta API token in functions/.env',
      ads: [],
      topHooks: []
    };
  }

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
    'publisher_platforms'
  ].join(',');

  const adsMap = new Map();
  const allTerms = [brandName, ...searchKeywords].filter(Boolean);

  for (const term of allTerms) {
    const params = new URLSearchParams({
      access_token: USER_TOKEN,
      ad_reached_countries: JSON.stringify(countries),
      ad_active_status: 'ALL',
      search_terms: term,
      fields: fields,
      limit: limitPerTerm.toString()
    });

    const endpoint = `https://graph.facebook.com/v20.0/ads_archive?${params.toString()}`;
    const res = await fetchJson(endpoint);

    if (res.error) {
      console.log(`  [Notice] API Query for "${term}": ${res.error.message}`);
      continue;
    }

    const data = res.data || [];
    let newCount = 0;
    data.forEach(ad => {
      if (ad && ad.id && !adsMap.has(ad.id)) {
        adsMap.set(ad.id, ad);
        newCount++;
      }
    });

    console.log(`  Query "${term}" -> Found ${data.length} ads (${newCount} unique added)`);
  }

  const rawAds = Array.from(adsMap.values());
  console.log(`\nAnalyzing ${rawAds.length} candidate ads for hook psychology & pacing...`);

  // Parse and evaluate ads
  const evaluatedAds = rawAds.map(ad => {
    const body = (ad.ad_creative_bodies || [])[0] || '';
    const headline = (ad.ad_creative_link_titles || [])[0] || '';
    const caption = (ad.ad_creative_link_captions || [])[0] || '';
    const platforms = ad.publisher_platforms || [];

    const start = new Date(ad.ad_delivery_start_time || ad.ad_creation_time || Date.now());
    const stop = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : new Date();
    const flightDays = Math.max(1, Math.round((stop - start) / (1000 * 60 * 60 * 24)));
    const isActive = !ad.ad_delivery_stop_time;

    // Extract first 1-2 sentences as the 3-second opening hook
    const sentences = body.split(/(?<=[.?!])\s+/).filter(Boolean);
    const openingHookText = sentences.slice(0, 2).join(' ') || headline || 'Check this out';
    const hookArchetype = classifyHookArchetype(openingHookText);

    // Score longevity & scale
    let winningScore = 20;
    if (flightDays >= 21) winningScore += 50;
    else if (flightDays >= 14) winningScore += 40;
    else if (flightDays >= 7) winningScore += 25;
    if (isActive) winningScore += 15;
    if (ad.eu_total_reach && ad.eu_total_reach > 1000) winningScore += 15;

    return {
      id: ad.id,
      pageName: ad.page_name,
      isActive,
      flightDays,
      startDate: ad.ad_delivery_start_time,
      platforms,
      headline,
      caption,
      body,
      openingHookText,
      hookArchetype,
      winningScore,
      adLibraryUrl: `https://www.facebook.com/ads/library/?id=${ad.id}`
    };
  });

  // Sort by winning score (longest running ads = highest proven ROI)
  evaluatedAds.sort((a, b) => b.winningScore - a.winningScore);

  // Group top hooks
  const topHooks = evaluatedAds.slice(0, 8).map((ad, idx) => ({
    rank: idx + 1,
    pageName: ad.pageName,
    flightDays: ad.flightDays,
    archetype: ad.hookArchetype,
    openingHook: ad.openingHookText,
    headline: ad.headline,
    winningScore: ad.winningScore,
    libraryUrl: ad.adLibraryUrl
  }));

  console.log(`Top ${topHooks.length} proven winning ad angles synthesized.`);

  return {
    success: true,
    totalAdsScanned: rawAds.length,
    activeAdsCount: evaluatedAds.filter(a => a.isActive).length,
    topWinningAds: evaluatedAds.slice(0, 10),
    topHooks: topHooks
  };
}

module.exports = {
  researchCompetitorMetaAds,
  classifyHookArchetype
};
