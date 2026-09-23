/** Browser-first multi-vector comparable ad finder. */
const { searchMetaAds } = require('./meta_browser_searcher');

const queryCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

async function queryMetaArchive(searchTerm, options = {}) {
  const countries = options.countries || ['US'];
  const status = options.status || 'ACTIVE';
  const limit = options.limit || 25;
  const mediaType = options.mediaType || 'ALL';
  const key = `${String(searchTerm || '').trim().toLowerCase()}::${countries.slice().sort().join(',')}::${status}::${mediaType}::${limit}`;
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { data: cached.data, error: null, fromCache: true };
  }
  const result = await searchMetaAds(searchTerm, { countries, status, limit, mediaType });
  if (result.data.length) queryCache.set(key, { data: result.data, timestamp: Date.now() });
  return result;
}

async function findComparables(searchPlan = {}, options = {}) {
  const merged = { ...(typeof searchPlan === 'object' ? searchPlan : {}), ...(typeof options === 'object' ? options : {}) };
  const { vectors = [], countries = ['US', 'GB', 'CA', 'AU'], status = 'ACTIVE',
    limitPerVector = 20, mediaType = 'ALL', enableAgenticLoop = true } = merged;
  const rawAdsMap = new Map();
  const vectorHits = {};
  const competitorPagesMap = new Map();
  const discoveryErrors = [];
  const seenTerms = new Set();
  const uniqueVectors = vectors.filter(vector => {
    const term = String(vector.query || '').trim().toLowerCase();
    if (!term || seenTerms.has(term)) return false;
    seenTerms.add(term); return true;
  }).slice(0, 4);
  const spam = /novels? lover|novel drama|casino|slots|horoscope|zodiac|psychic|tarot|payday loan|webtoon|manga/i;

  async function runVector(vector, limit = limitPerVector) {
    const term = String(vector.query || '').trim();
    if (!term) return;
    vectorHits[term] = vectorHits[term] || 0;
    const result = await queryMetaArchive(term, { countries, status, limit, mediaType });
    if (result.error && !result.data.length) {
      discoveryErrors.push({
        term,
        error: result.error,
        blocked: Boolean(result.blocked),
        blockReason: result.blockReason || null,
      });
      console.warn(`[BrowserSearch] "${term}": ${result.error}`);
    }
    for (const ad of result.data) {
      if (!ad.id || spam.test(ad.page_name || '')) continue;
      const existing = rawAdsMap.get(ad.id);
      if (!existing) rawAdsMap.set(ad.id, { ...ad, discoveryVectors: [vector.type || 'KEYWORD'], matchedQueries: [term] });
      else {
        existing.discoveryVectors = [...new Set([...existing.discoveryVectors, vector.type || 'KEYWORD'])];
        existing.matchedQueries = [...new Set([...existing.matchedQueries, term])];
        if (!existing.browserMedia && ad.browserMedia) existing.browserMedia = ad.browserMedia;
      }
      vectorHits[term]++;
      if (ad.page_name) competitorPagesMap.set(ad.page_name, (competitorPagesMap.get(ad.page_name) || 0) + 1);
    }
  }

  for (const vector of uniqueVectors) {
    const isCore = ['BRAND', 'PRODUCT', 'EXACT_BRAND', 'PRODUCT_NAME'].includes(vector.type);
    await runVector(vector, isCore ? Math.max(limitPerVector, 50) : limitPerVector);
  }

  const discoveredCompetitors = [];
  if (enableAgenticLoop && competitorPagesMap.size) {
    const recursiveSpam = /novel|fiction|manga|comic|casino|slots|horoscope|tarot|loan|mailchimp|shopify|wordpress/i;
    const pages = [...competitorPagesMap.entries()].filter(([name]) => name && !recursiveSpam.test(name))
      .sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [pageName] of pages) {
      if (uniqueVectors.some(vector => String(vector.query).toLowerCase() === pageName.toLowerCase())) continue;
      discoveredCompetitors.push(pageName);
      await runVector({ type: 'RECURSIVE_COMPETITOR', query: pageName }, 15);
    }
  }
  if (!rawAdsMap.size && discoveryErrors.length) {
    const blockedItem = discoveryErrors.find(item => item.blocked || /blocked/i.test(item.error));
    const error = new Error(blockedItem
      ? 'Meta blocked the browser session. Configure a trusted remote browser with BROWSER_WS_ENDPOINT or BROWSER_CDP_ENDPOINT.'
      : `Ads Library browser search failed: ${discoveryErrors[0].error}`);
    error.isBlocked = Boolean(blockedItem);
    error.blockReason = blockedItem?.blockReason || (blockedItem ? 'Meta blocked the browser session' : null);
    error.discoveryErrors = discoveryErrors;
    error.vectorHits = vectorHits;
    throw error;
  }
  return {
    totalRawAds: rawAdsMap.size,
    vectorHits,
    discoveredCompetitors,
    discoveryErrors,
    isBlocked: false,
    hasPartialBlocks: discoveryErrors.some(e => e.blocked),
    ads: [...rawAdsMap.values()],
  };
}

module.exports = { findComparables, queryMetaArchive };
