/** Browser-first multi-vector comparable ad finder. */
const { searchMetaAds } = require('./meta_browser_searcher');
const logger = require('./gcp_logger');

async function queryMetaArchive(searchTerm, options = {}) {
  const countries = options.countries || ['ALL'];
  const status = options.status || 'ACTIVE';
  const limit = options.limit || 25;
  const mediaType = options.mediaType || 'ALL';
  const searchType = options.searchType || 'keyword_unordered';
  // Queries intentionally remain live. Persisted media, not search results, is reused.
  try {
    const startedAt = Date.now();
    const budgetMs = Math.max(5000, Math.min(30000, Number(options.timeoutMs) || 30000));
    const request = timeoutMs => searchMetaAds(searchTerm,
      { countries, status, limit, mediaType, searchType, timeoutMs });
    let result = await request(budgetMs);
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (result.inconclusive && remainingMs >= 6000) {
      logger.info('Retrying inconclusive Meta search once', {
        query: searchTerm, remainingMs,
      });
      const retry = await request(remainingMs);
      if (retry.data?.length || !retry.inconclusive) result = retry;
    }
    return result;
  } catch (error) {
    logger.warn('Search browser unavailable', {
      query: searchTerm, errorType: error.name || 'Error', reason: String(error.message || '').slice(0, 200),
    });
    return { data: [], error: String(error.message || 'Browser unavailable').slice(0, 200), blocked: false };
  }
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
    minRecall = 5, maxQueries = 5, deadlineMs = 45000, queryArchive = queryMetaArchive, nextQueries,
    initialSearches = [] } = merged;
  const startedAt = Date.now();
  const rawAdsMap = new Map();
  const vectorHits = {};
  const competitorPagesMap = new Map();
  const discoveryErrors = [];
  const retrievalPlan = buildRetrievalPlan(vectors, maxQueries);

  function collectResult(vector, result = {}) {
    const term = String(vector.query || '').trim();
    vectorHits[term] = vectorHits[term] || 0;
    const data = Array.isArray(result.data) ? result.data : [];
    if (result.error && !data.length) {
      discoveryErrors.push({
        term,
        error: result.error,
        blocked: Boolean(result.blocked),
        blockReason: result.blockReason || null,
      });
      logger.warn('Search vector failed', {
        query: term, vectorType: vector.type || 'KEYWORD',
        blocked: Boolean(result.blocked), error: result.error,
      });
    }
    for (const ad of data) {
      if (!ad.id) continue;
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

  async function runVector(vector, limit = limitPerVector) {
    const term = String(vector.query || '').trim();
    if (!term) return;
    const remainingMs = Math.max(5000, Math.min(16000, deadlineMs - (Date.now() - startedAt)));
    const searchType = vector.searchType || options.searchType || 'keyword_unordered';
    const vectorStartedAt = Date.now();
    const result = await queryArchive(term, { countries, status, limit, mediaType, searchType, timeoutMs: remainingMs });
    collectResult(vector, result);
    logger.info('Search vector completed', {
      query: term, vectorType: vector.type || 'KEYWORD',
      resultCount: Array.isArray(result.data) ? result.data.length : 0,
      blocked: Boolean(result.blocked), durationMs: Date.now() - vectorStartedAt,
    });
  }

  // Run the canonical query once, then let the AI controller react to the
  // browser's evidence. The deterministic plan is reserved for AI outages.
  const attempted = [];
  const runPlanned = async vector => {
    const term = String(vector?.query || '').trim();
    if (!term || attempted.some(value => normalizedTerm(value) === normalizedTerm(term))) return false;
    attempted.push(term);
    await runVector(vector, limitPerVector);
    return true;
  };
  // The raw exact query may start while Gemini plans the follow-up strategy.
  // Reuse its live browser result instead of issuing the same search twice.
  for (const seeded of initialSearches) {
    const vector = seeded?.vector;
    const term = String(vector?.query || '').trim();
    if (!term || attempted.some(value => normalizedTerm(value) === normalizedTerm(term))) continue;
    attempted.push(term);
    collectResult(vector, seeded.result);
  }
  await runPlanned(retrievalPlan[0]);
  while (rawAdsMap.size < minRecall && attempted.length < maxQueries && Date.now() - startedAt < deadlineMs) {
    // AI planning and a browser query both need time; stop before an HTTP proxy
    // timeout would hide an otherwise valid partial result from the user.
    if (deadlineMs - (Date.now() - startedAt) < 8000) break;
    const remaining = maxQueries - attempted.length;
    let followups = [];
    if (typeof nextQueries === 'function') {
      followups = await nextQueries({
        attempted: [...attempted],
        candidates: [...rawAdsMap.values()],
        totalRawAds: rawAdsMap.size,
        remainingQueries: remaining,
      });
    }
    const aiCandidates = (Array.isArray(followups) ? followups : []).filter(vector =>
      vector?.query && !attempted.some(value => normalizedTerm(value) === normalizedTerm(vector.query)));
    const candidates = aiCandidates.length ? aiCandidates : retrievalPlan;
    const batch = [];
    // When the exact query is empty, two independent identity-preserving
    // searches can share the same browser wait. Avoid extra traffic once there
    // are already plausible hits.
    const batchWidth = rawAdsMap.size === 0 ? 2 : 1;
    for (const vector of candidates) {
      const term = normalizedTerm(vector?.query);
      if (!term || attempted.some(value => normalizedTerm(value) === term)
          || batch.some(value => normalizedTerm(value.query) === term)) continue;
      batch.push(vector);
      if (batch.length >= Math.min(batchWidth, maxQueries - attempted.length)) break;
    }
    if (!batch.length) break;
    await Promise.all(batch.map(vector => runPlanned(vector)));
  }

  const discoveredCompetitors = [];
  if (enableAgenticLoop && competitorPagesMap.size) {
    const genericPlatformExclude = /mailchimp|shopify|wordpress|facebook|instagram|meta|google|cloudflare/i;
    const pages = [...competitorPagesMap.entries()].filter(([name]) => name && !genericPlatformExclude.test(name))
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
    deadlineReached: Date.now() - startedAt >= deadlineMs,
    ads: [...rawAdsMap.values()],
  };
}

module.exports = { findComparables, queryMetaArchive, buildRetrievalPlan };
