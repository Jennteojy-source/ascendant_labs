/**
 * Multi-Vector Comparable Ad Finder
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Executes multi-vector searches against Meta Graph API (ads_archive):
 * - Vector A: Ads Search (niche, keywords, problem-solution hooks)
 * - Vector B: Advertiser Search (competitor brand pages)
 * - Vector C: Destination Domain & URL Search
 * 
 * Recursively discovers competitor pages running scaling campaigns.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}
loadEnv();

const USER_TOKEN =
  process.env.USER_TOKEN || process.env.META_ACCESS_TOKEN || process.env.CAPI_ACCESS_TOKEN;

function fetchJson(url) {
  return new Promise((resolve) => {
    https
      .get(url, { timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: { message: 'Failed to parse JSON: ' + e.message } });
          }
        });
      })
      .on('error', (err) => resolve({ error: { message: err.message } }))
      .on('timeout', () => resolve({ error: { message: 'Request timeout' } }));
  });
}

const metaQueryCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2-hour TTL

/**
 * Query Meta Graph API ads_archive for a single search term
 */
async function queryMetaArchive(searchTerm, options = {}) {
  if (!USER_TOKEN) {
    throw new Error('USER_TOKEN missing from functions/.env');
  }

  const countries = options.countries || ['US'];
  const status = options.status || 'ACTIVE'; // ACTIVE | ALL
  const limit = options.limit || 25;
  const mediaType = options.mediaType || 'ALL'; // ALL | VIDEO | IMAGE

  const normTerm = (searchTerm || '').trim().toLowerCase();
  const countriesKey = countries.slice().sort().join(',');
  const cacheKey = `${normTerm}::${countriesKey}::${status}::${mediaType}::${limit}`;

  if (metaQueryCache.has(cacheKey)) {
    const cached = metaQueryCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { data: cached.data || [], error: null, fromCache: true };
    }
  }

  const fields = [
    'id',
    'page_id',
    'page_name',
    'ad_creation_time',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'ad_snapshot_url',
    'ad_creative_bodies',
    'ad_creative_link_titles',
    'ad_creative_link_captions',
    'ad_creative_link_descriptions',
    'publisher_platforms',
    'languages',
    'eu_total_reach',
    'impressions',
    'spend',
  ].join(',');

  const params = new URLSearchParams({
    access_token: USER_TOKEN,
    ad_reached_countries: JSON.stringify(countries),
    fields,
    limit: String(limit),
  });

  if (status !== 'ALL') {
    params.set('ad_active_status', status);
  }
  if (mediaType && mediaType !== 'ALL') {
    params.set('media_type', mediaType);
  }
  if (searchTerm) {
    params.set('search_terms', searchTerm);
  }

  const url = `https://graph.facebook.com/v21.0/ads_archive?${params.toString()}`;
  const res = await fetchJson(url);

  if (res.error) {
    const errMsg = res.error.message || JSON.stringify(res.error);
    const isRateLimit =
      res.error.code === 17 ||
      res.error.code === 4 ||
      res.error.code === 80004 ||
      /request limit|rate limit|too many requests|reduce the amount of data/i.test(errMsg);

    if (isRateLimit) {
      console.warn(`[Meta API Rate Limit] Query "${searchTerm}" hit rate limit. Checking stale cache...`);
      if (metaQueryCache.has(cacheKey)) {
        const fallback = metaQueryCache.get(cacheKey);
        return { data: fallback.data || [], error: null, fromCacheFallback: true };
      }
    }
    return { data: [], error: errMsg };
  }

  const results = res.data || [];
  metaQueryCache.set(cacheKey, { data: results, timestamp: Date.now() });
  return { data: results, error: null };
}

/**
 * Execute Multi-Vector Search for Comparables
 */
async function findComparables(searchPlan = {}, options = {}) {
  const merged = { ...(typeof searchPlan === 'object' ? searchPlan : {}), ...(typeof options === 'object' ? options : {}) };
  const {
    vectors = [], // array of { type, query }
    countries = ['US', 'GB', 'CA', 'AU'],
    status = 'ACTIVE',
    limitPerVector = 20,
    mediaType = 'ALL',
    enableAgenticLoop = true,
  } = merged;

  const rawAdsMap = new Map(); // adId -> rawAd
  const vectorHits = {};
  const competitorPagesMap = new Map(); // pageName -> count of ads

  // Deduplicate search vectors by query string to prevent redundant API calls
  const seenTerms = new Set();
  const uniqueVectors = [];
  for (const v of vectors) {
    const term = (v.query || '').trim().toLowerCase();
    if (term && term.length >= 2 && !seenTerms.has(term)) {
      seenTerms.add(term);
      uniqueVectors.push(v);
    }
  }

  // 1. Run Search Vectors
  for (const vector of uniqueVectors) {
    const term = vector.query ? vector.query.trim() : '';
    if (!term || term.length < 2) continue;

    vectorHits[term] = 0;
    const { data, error } = await queryMetaArchive(term, {
      countries,
      status,
      limit: limitPerVector,
      mediaType,
    });

    if (error) {
      console.warn(`[ComparableFinder] Notice for query "${term}": ${error}`);
      continue;
    }

    for (const ad of data) {
      if (!ad.id) continue;

      if (!rawAdsMap.has(ad.id)) {
        rawAdsMap.set(ad.id, {
          ...ad,
          discoveryVectors: [vector.type || 'KEYWORD'],
          matchedQueries: [term],
        });
      } else {
        const existing = rawAdsMap.get(ad.id);
        if (!existing.discoveryVectors.includes(vector.type)) {
          existing.discoveryVectors.push(vector.type);
        }
        if (!existing.matchedQueries.includes(term)) {
          existing.matchedQueries.push(term);
        }
      }

      vectorHits[term]++;

      // Track competitor pages
      if (ad.page_name) {
        competitorPagesMap.set(
          ad.page_name,
          (competitorPagesMap.get(ad.page_name) || 0) + 1
        );
      }
    }
  }

  // 2. Recursive Agentic Competitor Discovery Loop
  // If top competitor pages emerge with multiple scaling ads, search their specific page names
  const discoveredCompetitors = [];
  if (enableAgenticLoop && competitorPagesMap.size > 0) {
    // Sort pages by ad count and ensure they are not fiction/spam, generic SaaS, or self
    const spamPagePatterns = /novel|fiction|story|werewolf|billionaire|manga|comic|casino|slots|horoscope|zodiac|psychic|tarot|loan|constant contact|mailchimp|klaviyo|shopify|wordpress/i;
    const sortedPages = Array.from(competitorPagesMap.entries())
      .filter(([pageName]) => {
        if (!pageName || pageName.length < 3) return false;
        if (spamPagePatterns.test(pageName)) return false;
        const isSelf = vectors.some(v => v.query && v.query.toLowerCase() === pageName.toLowerCase());
        return !isSelf;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3); // top 3 verified competitor pages

    for (const [competitorPage] of sortedPages) {
      discoveredCompetitors.push(competitorPage);
      const { data } = await queryMetaArchive(competitorPage, {
        countries,
        status,
        limit: 15,
        mediaType,
      });

      for (const ad of data) {
        if (!ad.id) continue;
        if (!rawAdsMap.has(ad.id)) {
          rawAdsMap.set(ad.id, {
            ...ad,
            discoveryVectors: ['RECURSIVE_COMPETITOR'],
            matchedQueries: [competitorPage],
          });
        }
      }
    }
  }

  const allAds = Array.from(rawAdsMap.values());
  return {
    totalRawAds: allAds.length,
    vectorHits,
    discoveredCompetitors,
    ads: allAds,
  };
}

module.exports = {
  findComparables,
  queryMetaArchive,
};
