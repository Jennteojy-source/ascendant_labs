/** Adaptive Gemini controller for public Ads Library research. */
const { generateText } = require('./vertex_ai');

function brandTokens(value) {
  return String(value || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 3);
}

function sanitizeAgentQueries(queries, brandName, remaining) {
  const identity = brandTokens(brandName);
  const seen = new Set();
  return (Array.isArray(queries) ? queries : []).flatMap(item => {
    const query = String(item?.query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = query.toLowerCase();
    if (!query || seen.has(key) || (identity.length && !identity.some(token => key.includes(token)))) return [];
    seen.add(key);
    return [{ type: String(item?.type || 'AI_FOLLOWUP').toUpperCase().slice(0, 40), query }];
  }).slice(0, Math.max(0, remaining));
}

async function decideNextSearch({ input, profile = {}, attempted = [], candidates = [], remainingQueries = 0 }) {
  if (!remainingQueries) return [];
  const identity = profile.brandName || input;
  const evidence = candidates.slice(0, 12).map(ad => ({
    id: ad.id, page: ad.page_name, copy: (ad.ad_creative_bodies || []).join(' ').slice(0, 180),
  }));
  const prompt = `You are directing a browser research agent using the public Meta Ads Library. Decide whether another GLOBAL search query is useful for the same product/brand. Do not choose countries. Do not invent rival brands.\n\nUser input: ${JSON.stringify(input)}\nCanonical identity: ${JSON.stringify(identity)}\nAlready searched: ${JSON.stringify(attempted)}\nLive browser evidence (${candidates.length} unique ads): ${JSON.stringify(evidence)}\nRemaining query budget: ${remainingQueries}\n\nReturn raw JSON only: {"queries":[{"type":"PAGE_VARIATION|SPELLING_PERMUTATION|AFFILIATE_ANGLE|PRODUCT_NAME","query":"short identity-preserving query"}]}. Return an empty array when evidence is sufficient or no safe next query exists. Choose at most ${remainingQueries} queries. Every query must retain a meaningful token from the canonical identity.`;
  try {
    const raw = await generateText(prompt, { temperature: 0.1, maxOutputTokens: 400 });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return sanitizeAgentQueries(parsed?.queries, identity, remainingQueries);
  } catch {
    return [];
  }
}

module.exports = { decideNextSearch, sanitizeAgentQueries };
