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

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { generateText } = require('./vertex_ai');

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
          timeout: 4000,
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < maxRedirects) {
            hops++;
            res.resume();
            return go(new URL(res.headers.location, target).toString());
          }

          // Immediately abort on Cloudflare / anti-bot challenge status codes
          if (res.statusCode === 403 || res.statusCode === 503) {
            res.resume();
            return resolve({
              statusCode: res.statusCode,
              html: '',
              finalUrl: target,
              isBotBlocked: true,
            });
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

async function profileWithAI(inputUrl, textContext = '') {
  const prompt = `You are an elite Meta Ad & Direct-Response Intelligence Agent.
Target URL to analyze: "${inputUrl}"
${textContext ? `Page context / Scraped Copy:\n"""${textContext.slice(0, 2000)}"""\n` : ''}

Analyze this product or landing page. If it is an affiliate pre-lander, bridge page (e.g. on carrd.co, clickfunnels, leadpages), or review article, identify the ACTUAL core brand and offer being promoted (strip any campaign/lander suffixes like 01, vsl, offer, review).

Return ONLY a valid raw JSON object (no markdown, no backticks):
{
  "brandName": "Official canonical brand/offer name",
  "pageType": "OFFICIAL_BRAND_STORE | AFFILIATE_PRELANDER | REVIEW_EDITORIAL | DIRECT_RESPONSE_VSL",
  "category": "Consumer niche or market vertical",
  "coreProduct": "Specific product name or mechanism",
  "primaryPainPoints": ["pain point 1", "pain point 2"],
  "keyBenefits": ["key benefit 1", "key benefit 2"],
  "directCompetitors": ["known competitor brand 1", "known competitor brand 2"],
  "searchKeywords": ["keyword 1", "keyword 2"],
  "suggestedVectors": [
    { "type": "BRAND", "query": "Canonical Brand Name" },
    { "type": "MECHANISM", "query": "Unique Mechanism or Product Angle" },
    { "type": "PROBLEM", "query": "Customer Pain Point Hook" },
    { "type": "COMPETITOR", "query": "Top Competitor Name or Alternative" }
  ]
}`;

  try {
    const raw = await generateText(prompt, { temperature: 0.1, maxOutputTokens: 1200 });
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.brandName && Array.isArray(parsed.suggestedVectors)) {
      return parsed;
    }
  } catch (err) {
    // Fallback if AI call times out
  }
  return null;
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

  // Extract meta/title text
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let rawTitle = titleMatch ? cleanText(titleMatch[1]) : '';
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  let description = descMatch ? cleanText(descMatch[1]) : '';

  const isChallenge = /just a moment|attention required|access denied|security check|cloudflare|ddos protection|verify you are human|bot detection/i.test(
    `${rawTitle} ${description}`
  );

  const cleanContext = isChallenge ? '' : `${rawTitle} ${description}`;

  // 1. Primary: Leverage Google Gemini AI model intelligence
  const aiProfile = await profileWithAI(cleanUrl, cleanContext);
  if (aiProfile) {
    return {
      url: cleanUrl,
      finalUrl,
      brandName: aiProfile.brandName,
      pageType: aiProfile.pageType || 'OFFICIAL_BRAND_STORE',
      domain: rootDomain,
      title: rawTitle || aiProfile.brandName,
      description: description || `${aiProfile.brandName} - ${aiProfile.coreProduct}`,
      category: aiProfile.category || 'Direct Response Offer',
      coreProduct: aiProfile.coreProduct || aiProfile.brandName,
      primaryPainPoints: aiProfile.primaryPainPoints || ['affordability', 'reliability'],
      keyBenefits: aiProfile.keyBenefits || ['proven results', 'guarantee'],
      directCompetitors: aiProfile.directCompetitors || [],
      searchKeywords: aiProfile.searchKeywords || [aiProfile.brandName, rootDomain],
      suggestedVectors: [
        ...(aiProfile.suggestedVectors || []),
        { type: 'DOMAIN', query: rootDomain }
      ]
    };
  }

  // 2. Generic Heuristic Fallback (Only if AI key missing or network down)
  const rawSub = rootDomain.split('.')[0];
  const baseDomain = rawSub.replace(/[-_]?\d+$/, '');
  const genericBrand = (baseDomain || rawSub).charAt(0).toUpperCase() + (baseDomain || rawSub).slice(1);

  return {
    url: cleanUrl,
    finalUrl,
    brandName: genericBrand,
    domain: rootDomain,
    title: rawTitle || genericBrand,
    description: description.slice(0, 240) || `Offer on ${rootDomain}`,
    category: 'E-commerce & Direct Response',
    coreProduct: genericBrand,
    primaryPainPoints: ['quality', 'reliability', 'affordability'],
    keyBenefits: ['effective solution', 'money back guarantee'],
    searchKeywords: [genericBrand, rootDomain],
    suggestedVectors: [
      { type: 'BRAND', query: genericBrand },
      { type: 'DOMAIN', query: rootDomain }
    ]
  };
}

module.exports = {
  profilePDP
};
