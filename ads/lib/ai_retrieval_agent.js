/** Adaptive Gemini controller for public Ads Library research. */
const { generateText } = require('./vertex_ai');

function sanitizeAgentQueries(queries, brandName, remaining, options = {}) {
  const identities = [brandName, ...(options.aliases || [])]
    .map(value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);
  const seen = new Set();
  return (Array.isArray(queries) ? queries : []).flatMap(item => {
    const query = String(item?.query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = query.toLowerCase();
    const type = String(item?.type || 'AI_FOLLOWUP').toUpperCase().slice(0, 40);
    const isCategoryOrCompetitor = type === 'COMPETITOR' || type === 'CATEGORY_OFFER' || type === 'RECURSIVE_COMPETITOR';
    if (!query || seen.has(key)) return [];
    const compactQuery = key.replace(/[^\p{L}\p{N}]+/gu, '');
    if (isCategoryOrCompetitor && options.intentType !== 'CATEGORY') return [];
    if (options.intentType !== 'CATEGORY' && identities.length &&
        !identities.some(identity => compactQuery.includes(identity))) return [];
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
  const aliases = profile.aliases || [];
  const evidence = candidates.slice(0, 12).map(ad => ({
    id: ad.id, page: ad.page_name, copy: (ad.ad_creative_bodies || []).join(' ').slice(0, 180),
  }));

  const officialCandidates = candidates.filter(ad =>
    ad.page_name && ad.page_name.toLowerCase().includes(identity.toLowerCase()));

  const prompt = `You are an AI research director for the Meta Ads Library.
Your GOAL: Find the most comprehensive and relevant active ads for the user's target: "${input}".
Canonical brand: "${identity}"
Category: "${category}"
Search intent: ${profile.intentType || 'NAMED_OFFER'}
Verified aliases: ${JSON.stringify(aliases)}
Geographic focus: ${targetCountry ? JSON.stringify(targetCountry) : '"GLOBAL (ALL)"'}
Already attempted searches: ${JSON.stringify(attempted)}
Current discovered ads (${candidates.length} ads, ${officialCandidates.length} official matches):
${JSON.stringify(evidence)}
Remaining query budget: ${remainingQueries}

STRATEGY RULES:
1. If official brand ads are sparse (< 2 found), suggest high-probability brand name variations or advertiser page variations.
2. If the user query has geographic intent (e.g. Singapore, UK), include target country codes (e.g. "countries": ["SG"]).
3. For a named offer, search only the exact offer or a verified alias. For a category, search relevant category products. Do not invent aliases or infer relevance from a shared broad word.
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
    return sanitizeAgentQueries(parsed?.queries, identity, remainingQueries, profile);
  } catch {
    return [];
  }
}

module.exports = { decideNextSearch, sanitizeAgentQueries };
