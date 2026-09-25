/** Bounded decision trail for one live search. No signed asset URLs or client identifiers. */
function buildSearchEvaluation({ rawAds = [], deterministicAds = [], rerankedAds = [], returnedAds = [],
  retrievalAttempts = [], pipeline = {}, profile = null } = {}) {
  const deterministic = new Map(deterministicAds.map((ad, index) => [String(ad.id), { ad, index }]));
  const reranked = new Map(rerankedAds.map((ad, index) => [String(ad.id), { ad, index }]));
  const returned = new Map(returnedAds.map((ad, index) => [String(ad.id), { ad, index }]));
  const candidates = rawAds.slice(0, 150).map(ad => {
    const id = String(ad.id);
    const first = deterministic.get(id);
    const judged = reranked.get(id);
    const shown = returned.get(id);
    return {
      id,
      matchedQueries: (ad.matchedQueries || []).slice(0, 6),
      discoveryVectors: (ad.discoveryVectors || []).slice(0, 6),
      searchMediaStatus: ad.browserMedia?.status || 'missing',
      deterministicRank: first ? first.index + 1 : null,
      deterministicScore: first?.ad.ranking?.rankScore ?? null,
      aiRank: judged ? judged.index + 1 : null,
      aiScore: judged?.ad.ranking?.relevanceScore ?? null,
      relationship: judged?.ad.ranking?.relationship || null,
      reason: String(judged?.ad.ranking?.reason || '').slice(0, 180),
      returnedRank: shown ? shown.index + 1 : null,
      fate: !first ? 'removed_before_ranking' : !judged ? 'removed_during_reranking'
        : !shown ? 'filtered_after_reranking' : 'returned',
    };
  });
  return {
    version: 1,
    queryVectors: (profile?.searchVectors || []).slice(0, 8).map(vector => ({
      type: vector.type || null, query: String(vector.query || '').slice(0, 100),
    })),
    retrievalAttempts: retrievalAttempts.slice(0, 10),
    counts: { raw: rawAds.length, deterministic: deterministicAds.length,
      reranked: rerankedAds.length, returned: returnedAds.length,
      searchMediaReady: rawAds.filter(ad => ad.browserMedia?.status === 'ready').length },
    pipeline,
    candidates,
    truncatedCandidates: Math.max(0, rawAds.length - candidates.length),
  };
}

module.exports = { buildSearchEvaluation };
