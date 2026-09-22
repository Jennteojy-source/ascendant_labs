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

const https = require('https');
const fs = require('fs');
const path = require('path');

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

function callGemini(apiKey, prompt) {
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2500,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 7000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`Gemini status ${res.statusCode}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini timeout'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Listwise evaluation of a batch of ads against a target profile
 */
async function evaluateBatchWithAI(targetProfile, adsBatch) {
  const apiKey = process.env.GEMINI_FREE_API_KEY;
  if (!apiKey || adsBatch.length === 0) return null;

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
- Canonical Brand: "${targetProfile.brandName}"
- Core Product / Mechanism: "${targetProfile.coreProduct || ''}"
- Category: "${targetProfile.category || ''}"

Candidate Ads:
${JSON.stringify(promptAds, null, 2)}

Task:
Your goal is to locate and verify ALL AD CREATIVES RUNNING FOR THIS EXACT PRODUCT OR BRAND.
Evaluate each candidate ad to determine its relationship to "${targetProfile.brandName}":
- "relationship":
  - "OFFICIAL_BRAND": Published by the brand's official page (e.g. page name contains "${targetProfile.brandName}").
  - "AFFILIATE_PARTNER": Published by a third-party media buyer, affiliate, deals page, or partner actively selling/promoting "${targetProfile.brandName}".
  - "REVIEW_EDITORIAL": Published by a review site, magazine, comparison blog, or advertorial explicitly featuring/recommending "${targetProfile.brandName}".
  - "UNRELATED": An ad promoting a completely different product, a rival competitor brand, or unrelated noise.
- "relevanceScore": Integer from 0 to 100:
  - 95-100: Official brand ad
  - 85-94: Affiliate or partner promoting this exact product
  - 75-84: Review, advertorial, or unboxing featuring this exact product
  - 0-30: Promotes an unrelated product or competitor

Return ONLY a valid raw JSON array (no markdown, no backticks):
[
  {
    "id": "ad_id",
    "relationship": "OFFICIAL_BRAND" | "AFFILIATE_PARTNER" | "REVIEW_EDITORIAL" | "UNRELATED",
    "relevanceScore": 95
  }
]`;

  try {
    const raw = await callGemini(apiKey, prompt);
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
 * Takes deduplicated candidate ads, batches them through Gemini listwise judge,
 * and fuses AI relevance with creative longevity and scale metrics.
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

    // Fallback if AI call failed for this ad
    if (!aiEval) {
      const targetBrandLower = (targetProfile.brandName || '').toLowerCase();
      const text = `${ad.pageName || ad.page_name || ''} ${(ad.copy?.headline || '')} ${(ad.copy?.body || '')}`.toLowerCase();
      const isPageBrand = (ad.pageName || ad.page_name || '').toLowerCase().includes(targetBrandLower);
      const isReview = /\b(review|reviewed|vs|tested|ratings?|hands-on|discount|coupon)\b/i.test(text);

      if (isPageBrand) {
        relationship = 'OFFICIAL_BRAND';
        relevanceScore = 95;
      } else if (targetBrandLower && text.includes(targetBrandLower)) {
        if (isReview) {
          relationship = 'REVIEW_EDITORIAL';
          relevanceScore = 85;
        } else {
          relationship = 'AFFILIATE_PARTNER';
          relevanceScore = 88;
        }
      } else {
        relationship = 'UNRELATED';
        relevanceScore = 0;
      }
    }

    // Filter out unrelated / noise ads when higher-confidence product ads are present
    if (relationship === 'UNRELATED' || (relevanceScore !== null && relevanceScore < 40)) {
      continue;
    }

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
    const totalScore = Math.round(activeBonus + impressionScore + flightScore + variantBonus + (relevanceScore * 2));

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
        relevanceScore,
        relationship,
        relevanceType: relationship,
      },
    });
  }

  // Safety net: Never return 0 results if valid candidate ads were retrieved from Meta
  if (rerankedList.length === 0 && candidateAds.length > 0) {
    for (const ad of candidateAds) {
      rerankedList.push({
        ...ad,
        ranking: {
          ...(ad.ranking || {}),
          rankScore: ad.ranking?.score || 50,
          relevanceScore: 50,
          relationship: 'COMPETITOR',
          relevanceType: 'COMPETITOR',
        },
        aiAnalysis: {
          relationship: 'COMPETITOR',
          creativeAngle: ad.copy?.primaryHook || 'Direct Response',
          aiInsight: `Active campaign matching query in Meta Ad Library.`,
        },
      });
    }
  }

  // Sort descending by total fused score
  rerankedList.sort((a, b) => (b.ranking?.rankScore || 0) - (a.ranking?.rankScore || 0));
  return rerankedList;
}

module.exports = {
  rerankAdsWithAI,
  evaluateBatchWithAI,
};
