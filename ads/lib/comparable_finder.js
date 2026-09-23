/** Browser-first multi-vector comparable ad finder. */
const { searchMetaAds } = require('./meta_browser_searcher');

async function queryMetaArchive(searchTerm, options = {}) {
  const countries = options.countries || ['ALL'];
  const status = options.status || 'ACTIVE';
  const limit = options.limit || 25;
  const mediaType = options.mediaType || 'ALL';
  // Queries intentionally remain live. Persisted media, not search results, is reused.
  return searchMetaAds(searchTerm, { countries, status, limit, mediaType });
}

function normalizedTerm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// These are query transformations, not location or data fallbacks. They run
// only when the exact global query has poor recall, and keep the search tied
// to the submitted identity.
function buildRetrievalPlan(vectors = [], maxQueries = 4) {
  const seen = new Set();
  const add = (result, type, query) => {
    const cleaned = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = normalizedTerm(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ type, query: cleaned });
  };

  const supplied = Array.isArray(vectors) ? vectors : [];
  const exact = supplied.find(vector => String(vector?.type).toUpperCase() === 'EXACT_BRAND') || supplied[0];
  const plan = [];
  add(plan, 'EXACT_BRAND', exact?.query);
  for (const vector of supplied) add(plan, String(vector?.type || 'EXPANDED').toUpperCase(), vector?.query);

  const exactTerm = String(exact?.query || '').trim();
  const compact = exactTerm.replace(/[^\p{L}\p{N}]+/gu, '');
  if (compact && normalizedTerm(compact) !== normalizedTerm(exactTerm)) add(plan, 'RELAXED_COMPACT', compact);
  const firstToken = exactTerm.split(/[^\p{L}\p{N}]+/u).find(token => token.length >= 3);
  if (firstToken && normalizedTerm(firstToken) !== normalizedTerm(exactTerm)) add(plan, 'RELAXED_BRAND_TOKEN', firstToken);

  return plan.slice(0, Math.max(1, Math.min(6, Number(maxQueries) || 4)));
}

async function findComparables(searchPlan = {}, options = {}) {
  const merged = { ...(typeof searchPlan === 'object' ? searchPlan : {}), ...(typeof options === 'object' ? options : {}) };
  const { vectors = [], countries = ['ALL'], status = 'ACTIVE',
    limitPerVector = 20, mediaType = 'ALL', enableAgenticLoop = true,
    minRecall = 5, maxQueries = 5, queryArchive = queryMetaArchive } = merged;
  const rawAdsMap = new Map();
  const vectorHits = {};
  const competitorPagesMap = new Map();
  const discoveryErrors = [];
  const retrievalPlan = buildRetrievalPlan(vectors, maxQueries);
  const spam = /novels? lover|novel drama|casino|slots|horoscope|zodiac|psychic|tarot|payday loan|webtoon|manga/i;

  async function runVector(vector, limit = limitPerVector) {
    const term = String(vector.query || '').trim();
    if (!term) return;
    vectorHits[term] = vectorHits[term] || 0;
    const result = await queryArchive(term, { countries, status, limit, mediaType });
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

  for (const vector of retrievalPlan) {
    // Exact global retrieval is always first. Additional terms are conditional
    // recall recovery, rather than a fixed fan-out that burns browser minutes.
    if (Object.keys(vectorHits).length && rawAdsMap.size >= minRecall) break;
    await runVector(vector, limitPerVector);
  }

  const discoveredCompetitors = [];
  if (enableAgenticLoop && competitorPagesMap.size) {
    const recursiveSpam = /novel|fiction|manga|comic|casino|slots|horoscope|tarot|loan|mailchimp|shopify|wordpress/i;
    const pages = [...competitorPagesMap.entries()].filter(([name]) => name && !recursiveSpam.test(name))
      .sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [pageName] of pages) {
      if (retrievalPlan.some(vector => normalizedTerm(vector.query) === normalizedTerm(pageName))) continue;
      discoveredCompetitors.push(pageName);
      await runVector({ type: 'RECURSIVE_COMPETITOR', query: pageName }, 15);
    }
  }
  if (!rawAdsMap.size && discoveryErrors.length) {
    const blockedItem = discoveryErrors.find(item => item.blocked || /blocked/i.test(item.error));
    const error = new Error(blockedItem
      ? 'Meta blocked the browser session. Configure the managed Browserless connection.'
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

module.exports = { findComparables, queryMetaArchive, buildRetrievalPlan };
