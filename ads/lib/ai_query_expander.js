/**
 * AI Query Expander — Semantic Search Vector Generator
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Takes any plain-text brand name, product name, or keyword and uses
 * Gemini Flash Lite to expand it into optimized multi-vector search
 * terms for the Meta Ads Library.
 * 
 * This is Stage 1 of the 4-stage search pipeline:
 *   1. AI Query Expansion (this module)
 *   2. Agentic Facebook Ads Library Search (comparable_finder.js)
 *   3. AI Ranking & Filtering (ai_reranker.js)
 *   4. Deterministic Rendering (frontend)
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
      maxOutputTokens: 1200,
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
        timeout: 5000,
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
 * Expand a user query into structured search intelligence using AI.
 * 
 * @param {string} userQuery - Raw user input (brand name, product name, keyword, or even a URL)
 * @returns {Object} Expanded query profile with search vectors
 */
async function expandQueryWithAI(userQuery) {
  const trimmed = (userQuery || '').trim();
  if (!trimmed) {
    return buildFallbackExpansion(trimmed);
  }

  const apiKey = process.env.GEMINI_FREE_API_KEY;
  if (!apiKey) {
    return buildFallbackExpansion(trimmed);
  }

  const prompt = `You are an elite Meta Ads Library search strategist. Your job is to take a user's search input and expand it into the optimal set of search terms to find relevant ads in the Facebook/Meta Ad Library.

User Input: "${trimmed}"

The user is searching for competitor ads and ad inspiration. They may have typed:
- A brand name (e.g. "Derila", "NordVPN", "Ridge Wallet")
- A product category (e.g. "memory foam pillow", "running shoes")
- A generic keyword (e.g. "weight loss", "dog training")
- A URL or domain (e.g. "derila-ergo.com" — extract the brand name from it)

Your task:
1. Identify the canonical brand or product being searched
2. Generate 3-6 optimized search terms that will find the most relevant ads in Meta Ads Library
3. Identify known competitors in this space
4. Identify customer pain points this product/brand addresses

Return ONLY a valid raw JSON object (no markdown, no backticks):
{
  "brandName": "The canonical brand or product name",
  "category": "Market vertical or niche (e.g. Sleep & Wellness, Cybersecurity, EDC Accessories)",
  "coreProduct": "Specific product name or type",
  "searchVectors": [
    { "type": "BRAND", "query": "exact brand name" },
    { "type": "PRODUCT", "query": "brand + product type" },
    { "type": "COMPETITOR", "query": "top competitor brand name" },
    { "type": "PROBLEM", "query": "pain point hook that ads in this niche use" }
  ],
  "competitors": ["competitor1", "competitor2", "competitor3"],
  "painPoints": ["pain point 1", "pain point 2"]
}

Rules:
- searchVectors should have 3-6 entries, each with a "type" and "query" field
- Always include at least one BRAND vector and one COMPETITOR vector
- BRAND queries should be the exact brand/product name (short, precise)
- COMPETITOR queries should be actual known competitor brand names
- PROBLEM queries should be short pain-point phrases that appear in ads
- If the input looks like a URL or domain, extract the brand name from it
- Keep query strings concise (1-4 words max) for best Meta Ads Library results`;

  try {
    const raw = await callGemini(apiKey, prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate minimum structure
    if (parsed.brandName && Array.isArray(parsed.searchVectors) && parsed.searchVectors.length > 0) {
      return {
        brandName: parsed.brandName,
        category: parsed.category || 'Direct Response',
        coreProduct: parsed.coreProduct || parsed.brandName,
        searchVectors: parsed.searchVectors.filter(v => v && v.query && v.type),
        competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
        painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints : [],
        source: 'ai',
      };
    }
  } catch (err) {
    // Fall through to heuristic fallback
  }

  return buildFallbackExpansion(trimmed);
}

/**
 * Deterministic fallback when AI is unavailable or fails.
 * Splits input into reasonable search vectors without any AI.
 */
function buildFallbackExpansion(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return {
      brandName: '',
      category: 'Unknown',
      coreProduct: '',
      searchVectors: [],
      competitors: [],
      painPoints: [],
      source: 'fallback',
    };
  }

  // If it looks like a URL/domain, extract a brand name from the hostname
  let effectiveName = trimmed;
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(trimmed)) {
    try {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      const host = url.hostname.replace(/^www\./, '');
      effectiveName = host.split('.')[0];
      // Capitalize first letter
      effectiveName = effectiveName.charAt(0).toUpperCase() + effectiveName.slice(1);
    } catch (e) {
      // Keep original input
    }
  }

  const words = effectiveName.split(/\s+/).filter(w => w.length >= 1);

  const searchVectors = [
    { type: 'BRAND', query: effectiveName },
    { type: 'PRODUCT', query: effectiveName },
  ];

  // For multi-word queries, add individual significant words as category vectors
  if (words.length > 1) {
    searchVectors.push({ type: 'CATEGORY', query: `${effectiveName} review` });
  }

  // For single-word brand names, add a qualifying vector
  if (words.length === 1 && effectiveName.length >= 3) {
    searchVectors.push({ type: 'CATEGORY', query: `${effectiveName} 50% off` });
  }

  return {
    brandName: effectiveName,
    category: 'Direct Response',
    coreProduct: effectiveName,
    searchVectors,
    competitors: [],
    painPoints: [],
    source: 'fallback',
  };
}

module.exports = {
  expandQueryWithAI,
  buildFallbackExpansion,
};
