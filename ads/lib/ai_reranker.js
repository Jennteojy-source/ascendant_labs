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

  const prompt = `You are a World-Class Direct Response Meta Ad Strategist and Evaluation Judge.
Target Offer to Analyze:
- Canonical Brand: "${targetProfile.brandName}"
- Core Product / Mechanism: "${targetProfile.coreProduct || ''}"
- Category: "${targetProfile.category || ''}"
- Primary Pain Points: ${(targetProfile.primaryPainPoints || []).join(', ')}
- Known Competitors: ${(targetProfile.directCompetitors || []).join(', ')}

Candidate Ads:
${JSON.stringify(promptAds, null, 2)}

Task:
Evaluate each ad for its relevance to this market and offer.
- "relationship":
  - "BRAND_AFFILIATE": The ad is run by the brand or by an affiliate/review page actively promoting "${targetProfile.brandName}".
  - "COMPETITOR": The ad promotes a rival product/brand solving the same customer pain points.
  - "NOISE": Completely irrelevant ad, spam, unrelated apps/games, or completely unrelated products.
- "relevanceScore": Integer from 0 (noise) to 100 (exact brand match or premier competitor).
- "creativeAngle": 2-4 word marketing archetype (e.g. "Doctor Authority Hook", "Microbiome Comparison", "UGC Transformation", "Social Proof Habit", "Direct Problem-Solution").
- "aiInsight": 1 punchy sentence explaining the direct-response angle and why this ad converts.

Return ONLY a valid raw JSON array (no markdown, no backticks):
[
  {
    "id": "ad_id",
    "relationship": "BRAND_AFFILIATE" | "COMPETITOR" | "NOISE",
    "relevanceScore": 95,
    "creativeAngle": "Creative Angle",
    "aiInsight": "1 sentence marketing strategy insight."
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
    let creativeAngle = aiEval ? aiEval.creativeAngle : null;
    let aiInsight = aiEval ? aiEval.aiInsight : null;

    // Fallback if AI call failed for this ad
    if (!aiEval) {
      const targetBrandLower = (targetProfile.brandName || '').toLowerCase();
      const text = `${ad.pageName || ad.page_name || ''} ${(ad.copy?.headline || '')} ${(ad.copy?.body || '')}`.toLowerCase();
      if (targetBrandLower && text.includes(targetBrandLower)) {
        relationship = 'BRAND_AFFILIATE';
        relevanceScore = 85;
        creativeAngle = 'Direct Offer Promotion';
        aiInsight = `Active creative promoting ${targetProfile.brandName}.`;
      } else {
        relationship = 'COMPETITOR';
        relevanceScore = 55;
        creativeAngle = 'Market Alternative';
        aiInsight = `Competitor ad solving adjacent ${targetProfile.category || 'consumer'} pain points.`;
      }
    }

    // Filter out noise
    if (relationship === 'NOISE' || (relevanceScore !== null && relevanceScore < 25)) {
      continue;
    }

    const flightDays = ad.stats?.flightDays || 1;
    const isActive = ad.stats?.isActive !== false;
    const variantCount = ad.variantCount || 1;

    // Reciprocal Rank Fusion: Longevity * ActiveWeight + AI Semantic Score + Variant Scaling Bonus
    const activeMultiplier = isActive ? 1.35 : 1.0;
    const longevityScore = Math.pow(flightDays, 1.12) * activeMultiplier;
    const variantBonus = Math.min(20, (variantCount - 1) * 3);
    const totalScore = Math.round(longevityScore + (relevanceScore * 1.1) + variantBonus);

    rerankedList.push({
      ...ad,
      ranking: {
        ...(ad.ranking || {}),
        rankScore: totalScore,
        relevanceScore,
        relationship,
        relevanceType: relationship === 'BRAND_AFFILIATE' ? 'DIRECT_BRAND' : 'COMPETITOR',
      },
      aiAnalysis: {
        relationship,
        creativeAngle: creativeAngle || 'Direct-Response Hook',
        aiInsight: aiInsight || `High-performing ad targeting ${targetProfile.category || 'customer demand'}.`,
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
