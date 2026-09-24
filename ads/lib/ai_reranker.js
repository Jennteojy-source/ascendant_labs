/**
 * Listwise AI Reranker & Strategic Reasoner (2026 RankLLM Pattern)
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Replaces hardcoded regexes and rigid keyword matching with an autonomous
 * LLM-as-a-Judge evaluation loop using Gemini Flash Lite.
 * 
 * Evaluates candidate ads in batch:
 * - Scores relevance (0–100) to the target offer
 * - Identifies ad relationship: BRAND_AFFILIATE vs COMPETITOR vs NOISE
 * - Discovers creative marketing angle (UGC, Authority, Comparison, etc.)
 * - Generates 1-sentence AI Strategic Insight for direct-response performance
 */

const { generateText } = require('./vertex_ai');

/**
 * Listwise evaluation of a batch of ads against a target profile
 */
async function evaluateBatchWithAI(targetProfile, adsBatch) {
  if (adsBatch.length === 0) return null;

  const promptAds = adsBatch.map((ad, idx) => ({
    index: idx + 1,
    id: ad.id,
    advertiser: ad.page_name || ad.pageName,
    headline: (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) || ad.copy?.headline || '',
    caption: (ad.ad_creative_link_captions && ad.ad_creative_link_captions[0]) || '',
    body: ((ad.ad_creative_bodies && ad.ad_creative_bodies[0]) || ad.copy?.body || '').slice(0, 220),
  }));

  const prompt = `You are a World-Class Direct Response Meta Ad Creative Strategist and Product Ad Judge.
Target Product to Analyze:
- Canonical Brand / Query: "${targetProfile.brandName}"
- Core Product / Mechanism: "${targetProfile.coreProduct || ''}"
- Category: "${targetProfile.category || ''}"

Candidate Ads:
${JSON.stringify(promptAds, null, 2)}

Task:
Evaluate each candidate ad to determine its relationship to "${targetProfile.brandName}":
- "relationship":
  - "OFFICIAL_BRAND": Published by the brand's official page (e.g. page name contains "${targetProfile.brandName}").
  - "AFFILIATE_PARTNER": Published by a third-party media buyer, affiliate, deals page, or partner actively selling/promoting "${targetProfile.brandName}".
  - "REVIEW_EDITORIAL": Published by a review site, magazine, comparison blog, or advertorial explicitly featuring/recommending "${targetProfile.brandName}".
  - "RELATED_OFFER": An ad in the same niche, competing product, related direct-response offer, or category creative. (Note: if the query is a product category rather than a specific brand, relevant category products are "RELATED_OFFER" or "OFFICIAL_BRAND").
  - "UNRELATED": Completely unrelated noise or off-topic ad.
- "relevanceScore": Integer from 0 to 100:
  - 95-100: Official brand ad
  - 85-94: Affiliate or partner promoting this exact product
  - 75-84: Review, advertorial, or unboxing featuring this exact product
  - 50-74: Related offer, competitor, or relevant category creative
  - 10-49: Broad or tangential match
  - 0-9: Pure off-topic noise

Return ONLY a valid raw JSON array (no markdown, no backticks):
[
  {
    "id": "ad_id",
    "relationship": "OFFICIAL_BRAND" | "AFFILIATE_PARTNER" | "REVIEW_EDITORIAL" | "RELATED_OFFER" | "UNRELATED",
    "relevanceScore": 95
  }
]`;

  try {
    const raw = await generateText(prompt, { temperature: 0.1, maxOutputTokens: 2500 }, { operation: 'ad_relevance' });
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    // Return null to allow graceful local heuristic fallback
  }
  return null;
}

/**
 * Main Reranker & Reasoner
 * Takes candidate ads, batches them through Gemini listwise judge,
 * and fuses AI relevance with creative longevity and scale metrics.
 * 
 * Never hard-drops candidate ads with binary filters; instead, computes
 * continuous rank scores so relevant ads rise to the top while low-relevance
 * ads sort to the bottom.
 */
async function rerankAdsWithAI(candidateAds, targetProfile, options = {}) {
  if (!candidateAds || candidateAds.length === 0) return [];

  const batchSize = 20;
  const aiEvaluationsMap = new Map();

  // Evaluate candidate ads in parallel batches (up to 40 ads total for speed and token limits)
  const toEvaluate = candidateAds.slice(0, 40);
  const batches = [];
  for (let i = 0; i < toEvaluate.length; i += batchSize) {
    batches.push(toEvaluate.slice(i, i + batchSize));
  }

  const batchPromises = batches.map((b) => evaluateBatchWithAI(targetProfile, b));
  const batchResults = await Promise.allSettled(batchPromises);

  for (const res of batchResults) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      for (const item of res.value) {
        if (item && item.id) {
          aiEvaluationsMap.set(String(item.id), item);
        }
      }
    }
  }

  const rerankedList = [];

  for (const ad of candidateAds) {
    const aiEval = aiEvaluationsMap.get(String(ad.id));

    // Determine relationship & relevance
    let relationship = aiEval ? aiEval.relationship : null;
    let relevanceScore = aiEval ? Number(aiEval.relevanceScore) : null;

    // Fallback if AI call failed or returned null for this ad
    if (!aiEval) {
      relationship = ad.ranking?.relevanceType || 'DISCOVERED';
      relevanceScore = ad.ranking?.relevanceScore || 45;
    }

    // Retain all candidate ads with continuous relevance scoring
    const effectiveRelevanceType = (!relationship)
      ? (ad.ranking?.relevanceType || 'DISCOVERED')
      : relationship;
    const effectiveRelevanceScore = relevanceScore !== null
      ? relevanceScore
      : (ad.ranking?.relevanceScore || 45);

    const flightDays = ad.stats?.flightDays || 1;
    const isActive = ad.stats?.isActive !== false;
    const variantCount = ad.variantCount || 1;
    const euReach = ad.stats?.euTotalReach ? Number(ad.stats.euTotalReach) : 0;

    // Active ads get top priority (+500 points).
    // High impression ads get up to +150 points.
    // Longevity adds up to +150 points.
    const activeBonus = isActive ? 500 : 0;
    let impressionScore = 10;
    let impressionTier = 'Low Impression';

    if (euReach >= 10000 || flightDays >= 21 || variantCount >= 4) {
      impressionTier = 'High Impression';
      impressionScore = 150;
    } else if (euReach >= 2000 || flightDays >= 7) {
      impressionTier = 'Moderate Scale';
      impressionScore = 60;
    } else {
      impressionTier = 'Low Impression';
      impressionScore = 10;
    }

    const flightScore = Math.min(150, flightDays * 3.5);
    const variantBonus = Math.min(40, (variantCount - 1) * 8);
    const totalScore = Math.round(activeBonus + impressionScore + flightScore + variantBonus + (effectiveRelevanceScore * 3));

    // Update stats with refined impressionTier
    if (ad.stats) {
      ad.stats.scaleTier = impressionTier;
      ad.stats.impressionTier = impressionTier;
    }

    rerankedList.push({
      ...ad,
      ranking: {
        ...(ad.ranking || {}),
        rankScore: totalScore,
        relevanceScore: effectiveRelevanceScore,
        relationship: effectiveRelevanceType,
        relevanceType: effectiveRelevanceType,
      },
    });
  }

  // Sort descending by total fused score
  rerankedList.sort((a, b) => (b.ranking?.rankScore || 0) - (a.ranking?.rankScore || 0));
  return rerankedList;
}

module.exports = {
  rerankAdsWithAI,
  evaluateBatchWithAI,
};
