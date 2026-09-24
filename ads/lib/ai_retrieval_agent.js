/** Adaptive Gemini controller for public Ads Library research. */
const { generateText } = require('./vertex_ai');

function brandTokens(value) {
  return String(value || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 3);
}

function sanitizeAgentQueries(queries, brandName, remaining, options = {}) {
  const identity = brandTokens(brandName);
  const seen = new Set();
  const allowCategory = Boolean(options.allowCategory);
  return (Array.isArray(queries) ? queries : []).flatMap(item => {
    const query = String(item?.query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = query.toLowerCase();
    const type = String(item?.type || 'AI_FOLLOWUP').toUpperCase().slice(0, 40);
    const isCategoryOrCompetitor = type === 'COMPETITOR' || type === 'CATEGORY_OFFER' || type === 'RECURSIVE_COMPETITOR';
    if (!query || seen.has(key)) return [];
    if (!isCategoryOrCompetitor || !allowCategory) {
      if (identity.length && !identity.some(token => key.includes(token))) return [];
    }
    seen.add(key);
    const sanitized = { type, query };
    if (Array.isArray(item?.countries) && item.countries.length) sanitized.countries = item.countries;
    if (item?.pageId) sanitized.pageId = item.pageId;
    return [sanitized];
  }).slice(0, Math.max(0, remaining));
}

async function decideNextSearch({ input, profile = {}, attempted = [], candidates = [], remainingQueries = 0 }) {
  if (!remainingQueries) return [];
  const identity = profile.brandName || input;
  const targetCountry = profile.targetCountry || null;
  const category = profile.category || 'Direct Response Offer';
  const evidence = candidates.slice(0, 12).map(ad => ({
    id: ad.id, page: ad.page_name, copy: (ad.ad_creative_bodies || []).join(' ').slice(0, 180),
  }));

  const officialCandidates = candidates.filter(ad =>
    ad.page_name && ad.page_name.toLowerCase().includes(identity.toLowerCase()));
  const isSparse = officialCandidates.length < 2;

  const prompt = `You are an AI research director for the Meta Ads Library.
Your GOAL: Find the most comprehensive and relevant active ads for the user's target: "${input}".
Canonical brand: "${identity}"
Category: "${category}"
Geographic focus: ${targetCountry ? JSON.stringify(targetCountry) : '"GLOBAL (ALL)"'}
Already attempted searches: ${JSON.stringify(attempted)}
Current discovered ads (${candidates.length} ads, ${officialCandidates.length} official matches):
${JSON.stringify(evidence)}
Remaining query budget: ${remainingQueries}

STRATEGY RULES:
1. If official brand ads are sparse (< 2 found), suggest high-probability brand name variations or advertiser page variations.
2. If the user query has geographic intent (e.g. Singapore, UK), include target country codes (e.g. "countries": ["SG"]).
3. If official ads are truly absent after searching, suggest top category competitors or category problem queries so the search never returns zero value.
4. Output at most ${remainingQueries} queries.

Return raw JSON only:
{"queries":[{"type":"PAGE_VARIATION|AFFILIATE_ANGLE|PRODUCT_NAME|COMPETITOR","query":"search string","countries":["ALL" or "SG"]}]}`;

  try {
    const raw = await generateText(prompt, {
      temperature: 0.1,
      maxOutputTokens: 800,
      thinkingConfig: { thinkingBudget: 0 },
    }, { operation: 'search_followup' });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return sanitizeAgentQueries(parsed?.queries, identity, remainingQueries, { allowCategory: isSparse });
  } catch {
    return [];
  }
}

module.exports = { decideNextSearch, sanitizeAgentQueries };
