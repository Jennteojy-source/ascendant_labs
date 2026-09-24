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
 *   2. Browser-based Facebook Ads Library Search (comparable_finder.js)
 *   3. AI Ranking & Filtering (ai_reranker.js)
 *   4. Deterministic Rendering (frontend)
 */

const { generateText } = require('./vertex_ai');

function sanitizeSearchVectors(brandName, vectors = [], options = {}) {
  const brand = String(brandName || '').trim();
  const brandTokens = brand.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2);
  const seen = new Set();
  const safe = [];
  const targetCountry = options.targetCountry || 'ALL';
  const defaultCountries = targetCountry && targetCountry !== 'ALL' ? [targetCountry] : ['ALL'];

  const candidates = [
    { type: 'EXACT_BRAND', query: brand, countries: defaultCountries },
    ...(targetCountry !== 'ALL' ? [{ type: 'GLOBAL_BRAND', query: brand, countries: ['ALL'] }] : []),
    ...vectors,
  ];

  for (const vector of candidates) {
    const query = String(vector?.query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const normalized = query.toLowerCase();
    const vecCountries = Array.isArray(vector?.countries) && vector.countries.length ? vector.countries : defaultCountries;
    const key = `${normalized}:${vecCountries.join(',')}`;
    if (!query || seen.has(key)) continue;
    // Every expansion must retain the target identity; this prevents AI drift into rival brands.
    if (brandTokens.length && !brandTokens.some(token => normalized.includes(token))) continue;
    seen.add(key);
    safe.push({
      type: String(vector?.type || 'KEYWORD').slice(0, 40),
      query,
      countries: vecCountries,
    });
    if (safe.length >= 5) break;
  }
  return safe.length ? safe : [{ type: 'EXACT_BRAND', query: brand, countries: ['ALL'] }];
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

  const prompt = `You are an elite Meta Ads Library creative intelligence strategist. Your job is to take a user's search input for a SPECIFIC PRODUCT, BRAND, OR LOCAL ADVERTISER and expand it into the optimal set of search term permutations to locate ALL active ads running for this entity in the Meta Ad Library (including official brand pages, affiliate media buyers, advertorials, and review campaigns).

User Input: "${trimmed}"

IMPORTANT OBJECTIVE:
The user wants to find ALL CREATIVES FOR THIS EXACT PRODUCT/BRAND. 
Do NOT search for rival competitor brands (e.g. if the user searches "Derila", DO NOT include Emma Sleep or Tempur-Pedic; if they search "NordVPN", DO NOT include Surfshark or ExpressVPN).

Your task:
1. Identify the canonical brand, entity, or product name being searched (strip generic city/region names from the core brand name, e.g. "Coding Labs Singapore" -> brandName: "Coding Lab").
2. Detect if the user specified a geographic country/region (e.g. "Singapore" -> "SG", "UK" -> "GB", "US" -> "US", "Australia" -> "AU", otherwise "ALL").
3. Generate 4-6 high-impact search term permutations to capture every ad for this product:
   - "EXACT_BRAND": The exact brand or product name
   - "PRODUCT_NAME": Brand + specific core product type/model (e.g. "Derila Pillow", "Ridge Carbon Wallet")
   - "PAGE_VARIATION": Likely Meta Page name variations (e.g. "Derila Official", "Coding Lab Asia", "NordVPN Deals")
   - "SPELLING_PERMUTATION": Alternate spacing, common spelling variations, or product nicknames
   - "AFFILIATE_ANGLE": Search terms used by affiliates, media buyers, or advertorials promoting this product (e.g. "Derila review", "Derila discount")
   - "DOMAIN_HANDLE": Likely primary domain or handle (e.g. "derila.com", "codinglab.com.sg")
4. Extract the product's primary hooks and angles.

Return ONLY a valid raw JSON object (no markdown, no backticks):
{
  "brandName": "Canonical Brand or Product Name",
  "category": "Market niche (e.g. Sleep & Ergonomics, Kids STEM Education, Oral Health)",
  "coreProduct": "Specific product name or mechanism",
  "targetCountry": "2-letter ISO country code or ALL",
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
- Keep queries concise (1-4 words max) for reliable matching in the public Meta Ads Library search UI.`;

  try {
    const raw = await generateText(
      prompt,
      { temperature: 0.1, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
      { operation: 'query_expansion' }
    );
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Heuristic geographic detection fallback if AI didn't catch it
    let targetCountry = parsed.targetCountry || 'ALL';
    if (targetCountry === 'ALL') {
      if (/\b(singapore|sg)\b/i.test(trimmed)) targetCountry = 'SG';
      else if (/\b(australia|aus?)\b/i.test(trimmed)) targetCountry = 'AU';
      else if (/\b(uk|united kingdom|britain|london)\b/i.test(trimmed)) targetCountry = 'GB';
      else if (/\b(canada|ca)\b/i.test(trimmed)) targetCountry = 'CA';
    }

    // Validate minimum structure
    if (parsed.brandName && Array.isArray(parsed.searchVectors) && parsed.searchVectors.length > 0) {
      return {
        brandName: parsed.brandName,
        category: parsed.category || 'Direct Response',
        coreProduct: parsed.coreProduct || parsed.brandName,
        targetCountry,
        productKeywords: Array.isArray(parsed.productKeywords) ? parsed.productKeywords : [parsed.coreProduct || parsed.brandName],
        searchVectors: sanitizeSearchVectors(parsed.brandName, parsed.searchVectors, { targetCountry }),
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
    searchVectors: sanitizeSearchVectors(effectiveName, searchVectors),
    painPoints: [],
    source: 'fallback',
  };
}

module.exports = {
  expandQueryWithAI,
  buildFallbackExpansion,
  sanitizeSearchVectors,
};
