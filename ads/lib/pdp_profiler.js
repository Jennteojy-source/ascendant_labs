/**
 * PDP Profiler & Semantic Extractor
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Takes a product detail page (PDP) or offer website, crawls the HTML,
 * parses metadata, OpenGraph, JSON-LD schema, and copy to extract:
 * - Brand name & core product
 * - Niche & category
 * - Customer pain points & key benefits
 * - Outbound destination domains / affiliate footprints
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function fetchHtml(urlStr, maxRedirects = 5) {
  return new Promise((resolve) => {
    let current = urlStr;
    let hops = 0;

    const go = (target) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch (e) {
        return resolve({ error: 'Invalid URL: ' + target, html: '', finalUrl: target });
      }

      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 12000,
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < maxRedirects) {
            hops++;
            res.resume();
            return go(new URL(res.headers.location, target).toString());
          }

          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 200,
              html: Buffer.concat(chunks).toString('utf8'),
              finalUrl: target,
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timeout', html: '', finalUrl: target });
      });
      req.on('error', (err) => resolve({ error: err.message, html: '', finalUrl: target }));
      req.end();
    };

    go(current);
  });
}

function cleanText(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Profile any product PDP or offer URL
 */
async function profilePDP(inputUrl) {
  let cleanUrl = inputUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl;
  }

  const { html, finalUrl, error } = await fetchHtml(cleanUrl);
  let parsedUrl;
  try {
    parsedUrl = new URL(finalUrl || cleanUrl);
  } catch (e) {
    parsedUrl = new URL(cleanUrl);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const rootDomain = hostname.replace(/^www\./, '');

  if (error || !html) {
    // Fallback based on domain name if fetch fails
    const brandGuess = rootDomain.split('.')[0].replace(/[-_]/g, ' ');
    return {
      url: cleanUrl,
      brandName: brandGuess.toUpperCase(),
      domain: rootDomain,
      title: brandGuess,
      description: `Competitor offer on ${rootDomain}`,
      category: 'E-commerce & Direct Response',
      coreProduct: brandGuess,
      primaryPainPoints: ['affordability', 'reliability', 'quality'],
      keyBenefits: ['effective solution', 'money back guarantee', 'fast shipping'],
      searchKeywords: [brandGuess, `${brandGuess} review`, `${brandGuess} deal`],
      suggestedVectors: [
        { type: 'BRAND', query: brandGuess },
        { type: 'DOMAIN', query: rootDomain }
      ]
    };
  }

  // 1. Meta & Title tags
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? cleanText(titleMatch[1]) : '';

  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogTitle = ogTitleMatch ? cleanText(ogTitleMatch[1]) : rawTitle;

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const description = descMatch ? cleanText(descMatch[1]) : '';

  // 2. Brand Name Extraction
  let brandName = '';
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSiteName && ogSiteName[1]) {
    brandName = cleanText(ogSiteName[1]);
  } else {
    // Extract from title (e.g. "Derila - The Memory Foam Pillow" or "ProDentim Official")
    const titleParts = ogTitle.split(/[-–—|:]/);
    if (titleParts.length > 1 && titleParts[0].trim().length < 30) {
      brandName = titleParts[0].trim();
    } else {
      brandName = rootDomain.split('.')[0].replace(/[-_]/g, ' ');
      brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1);
    }
  }

  // 3. Core Product & Category Detection
  const combinedText = `${ogTitle} ${description} ${rawTitle}`.toLowerCase();
  let coreProduct = '';
  let category = 'Direct Response Offer';

  const categoryMap = [
    { cat: 'Sleep & Ergonomics', keywords: ['pillow', 'mattress', 'cervical', 'neck pain', 'sleep', 'snoring', 'spine'] },
    { cat: 'Dental & Oral Health', keywords: ['teeth', 'oral', 'dental', 'gum', 'breath', 'dentist', 'whitening'] },
    { cat: 'Cybersecurity & Privacy', keywords: ['vpn', 'password', 'antivirus', 'encryption', 'security', 'privacy', 'ip'] },
    { cat: 'Weight Loss & Metabolism', keywords: ['weight loss', 'metabolism', 'diet', 'keto', 'fat burn', 'lean', 'calories'] },
    { cat: 'Joint & Pain Relief', keywords: ['joint', 'knee', 'arthritis', 'inflammation', 'sore', 'relief', 'cartilage'] },
    { cat: 'Pet Health & Training', keywords: ['dog', 'cat', 'puppy', 'pet', 'training', 'barking', 'canine'] },
    { cat: 'Travel & Mobility', keywords: ['flight', 'travel', 'car rental', 'booking', 'luggage', 'esim', 'roaming'] },
    { cat: 'Audio & Gadgets', keywords: ['earbuds', 'drone', 'camera', 'headphones', 'smartwatch', 'tracker'] }
  ];

  for (const item of categoryMap) {
    const hits = item.keywords.filter(k => combinedText.includes(k));
    if (hits.length > 0) {
      category = item.cat;
      coreProduct = hits.slice(0, 2).join(' ');
      break;
    }
  }

  if (!coreProduct) {
    coreProduct = ogTitle.split(' ').slice(0, 4).join(' ');
  }

  // 4. Pain Points & Benefits Harvester
  const painPoints = [];
  if (/neck|back|stiff|spine|pain|sore|hurt/i.test(combinedText)) painPoints.push('chronic pain & stiffness');
  if (/sleep|insomnia|tired|exhausted|snore/i.test(combinedText)) painPoints.push('restless sleep & fatigue');
  if (/expensive|bill|dentist|cost/i.test(combinedText)) painPoints.push('high medical/dental expenses');
  if (/hack|leak|track|spy|unsafe/i.test(combinedText)) painPoints.push('privacy exposure & data tracking');
  if (/yellow|plaque|breath|odor/i.test(combinedText)) painPoints.push('bad breath & stained teeth');
  if (painPoints.length === 0) painPoints.push('daily friction & inefficiency', 'lack of reliable alternatives');

  const keyBenefits = [];
  if (/fast|instant|immediate|seconds|quick/i.test(combinedText)) keyBenefits.push('fast acting results');
  if (/natural|organic|probiotic|plant/i.test(combinedText)) keyBenefits.push('100% natural formulation');
  if (/guarantee|money back|risk free|warranty/i.test(combinedText)) keyBenefits.push('60-day money back guarantee');
  if (/ergonomic|contour|cooling/i.test(combinedText)) keyBenefits.push('ergonomic patented contour');
  if (keyBenefits.length === 0) keyBenefits.push('premium quality', 'proven customer satisfaction');

  // 5. Generate High-Precision Search Vectors
  // Avoid long keyword-soup phrases which dilute Meta Ads Library queries
  const cleanCategoryKeyword = coreProduct.split(' ')[0] || 'product';
  const cleanNichePhrase = `${coreProduct} ${painPoints[0] ? painPoints[0].split(' ')[0] : ''}`.trim();

  const searchKeywords = [
    brandName,
    `${brandName} ${coreProduct}`.trim(),
    coreProduct,
    rootDomain
  ].filter(Boolean);

  const suggestedVectors = [
    { type: 'BRAND', query: brandName, description: 'Direct brand campaigns' },
    { type: 'PRODUCT', query: `${brandName} ${cleanCategoryKeyword}`.trim(), description: 'Brand product ads' },
    { type: 'CATEGORY', query: coreProduct, description: 'Direct category competitors' },
    { type: 'DOMAIN', query: rootDomain, description: 'Landing page domain ads' }
  ];

  return {
    url: cleanUrl,
    finalUrl,
    brandName,
    domain: rootDomain,
    title: ogTitle,
    description: description.slice(0, 240),
    category,
    coreProduct,
    primaryPainPoints: painPoints,
    keyBenefits: keyBenefits,
    searchKeywords,
    suggestedVectors
  };
}

module.exports = {
  profilePDP
};
