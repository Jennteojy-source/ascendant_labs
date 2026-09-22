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

  const prompt = `You are an elite Meta Ads Library creative intelligence strategist. Your job is to take a user's search input for a SPECIFIC PRODUCT OR BRAND and expand it into the optimal set of search term permutations to locate ALL active ads running for this product in the Meta Ad Library (including official brand pages, affiliate media buyers, advertorials, and review campaigns).

User Input: "${trimmed}"

IMPORTANT OBJECTIVE:
The user wants to find ALL CREATIVES FOR THIS EXACT PRODUCT/BRAND. 
Do NOT search for rival competitor brands (e.g. if the user searches "Derila", DO NOT include Emma Sleep or Tempur-Pedic; if they search "NordVPN", DO NOT include Surfshark or ExpressVPN).

Your task:
1. Identify the canonical brand or product name being searched.
2. Generate 4-6 high-impact search term permutations to capture every ad for this product:
   - "EXACT_BRAND": The exact brand or product name
   - "PRODUCT_NAME": Brand + specific core product type/model (e.g. "Derila Pillow", "Ridge Carbon Wallet")
   - "PAGE_VARIATION": Likely Meta Page name variations (e.g. "Derila Official", "GetDerila", "NordVPN Deals")
   - "SPELLING_PERMUTATION": Alternate spacing, common spelling variations, or product nicknames
   - "AFFILIATE_ANGLE": Search terms used by affiliates, media buyers, or advertorials promoting this product (e.g. "Derila review", "Derila discount")
   - "DOMAIN_HANDLE": Likely primary domain or handle (e.g. "derila.com", "getderila.com")
3. Extract the product's primary hooks and angles.

Return ONLY a valid raw JSON object (no markdown, no backticks):
{
  "brandName": "Canonical Brand or Product Name",
  "category": "Market niche (e.g. Sleep & Ergonomics, Cybersecurity, Smart Wallets)",
  "coreProduct": "Specific product name or mechanism",
  "productKeywords": ["keyword1", "keyword2", "keyword3"],
  "searchVectors": [
    { "type": "EXACT_BRAND", "query": "exact brand name" },
    { "type": "PRODUCT_NAME", "query": "brand + product" },
    { "type": "PAGE_VARIATION", "query": "likely advertiser page name" },
    { "type": "SPELLING_PERMUTATION", "query": "spelling or spacing variation" },
    { "type": "AFFILIATE_ANGLE", "query": "brand + review or advertorial hook" }
  ],
  "painPoints": ["pain point 1", "pain point 2"]
}

Rules:
- STRICT: NO RIVAL COMPETITOR BRANDS. Every search vector MUST contain the target brand or product name.
- Keep queries concise (1-4 words max) for optimal Meta Ads Library Graph API matching.`;

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
        productKeywords: Array.isArray(parsed.productKeywords) ? parsed.productKeywords : [parsed.coreProduct || parsed.brandName],
        searchVectors: parsed.searchVectors.filter(v => v && v.query && v.type),
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
    { type: 'EXACT_BRAND', query: effectiveName },
    { type: 'PAGE_VARIATION', query: `${effectiveName} Official` },
    { type: 'AFFILIATE_ANGLE', query: `${effectiveName} review` },
  ];

  if (words.length === 1 && effectiveName.length >= 3) {
    searchVectors.push({ type: 'PRODUCT_NAME', query: `${effectiveName} offer` });
  }

  return {
    brandName: effectiveName,
    category: 'Direct Response',
    coreProduct: effectiveName,
    productKeywords: [effectiveName],
    searchVectors,
    painPoints: [],
    source: 'fallback',
  };
}

module.exports = {
  expandQueryWithAI,
  buildFallbackExpansion,
};
