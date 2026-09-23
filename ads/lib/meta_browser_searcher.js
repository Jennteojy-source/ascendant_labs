/**
 * Public Meta Ads Library collector.
 *
 * Uses the public browser experience instead of the Graph/Ads Library API.
 * Extraction is layered: structured JSON first, visible DOM second.
 */
const { chromium } = require('playwright');
const { extractStructuredMedia, mediaResult } = require('./media_resolver');

const SEARCH_TIMEOUT_MS = 30000;
const MAX_SCROLLS = 12;
let browserPromise;

function browserlessEndpoint(env = process.env) {
  const token = env.BROWSERLESS_TOKEN || env.BROWSERLESS_API;
  if (!token) return null;
  const region = /^(sfo|lon|ams)$/.test(env.BROWSERLESS_REGION || '')
    ? env.BROWSERLESS_REGION : 'sfo';
  const country = /^[a-z]{2}$/i.test(env.BROWSERLESS_PROXY_COUNTRY || '')
    ? env.BROWSERLESS_PROXY_COUNTRY.toLowerCase() : 'us';
  const endpoint = new URL(`wss://production-${region}.browserless.io/chromium/playwright`);
  endpoint.searchParams.set('token', token);
  endpoint.searchParams.set('proxy', 'residential');
  endpoint.searchParams.set('proxyCountry', country);
  endpoint.searchParams.set('timeout', '110000');
  return endpoint.href;
}

function managedPlaywrightEndpoint(env = process.env) {
  const endpoint = browserlessEndpoint(env) || env.BROWSER_WS_ENDPOINT;
  if (!endpoint) return null;
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'wss:') {
    throw new Error('Managed browser endpoint must use encrypted wss:// transport');
  }
  return parsed.href;
}

function browserConnectionMode(env = process.env) {
  if (env.BROWSERLESS_TOKEN || env.BROWSERLESS_API) return 'managed-browserless';
  if (env.BROWSER_WS_ENDPOINT) return 'managed-playwright';
  return 'local-chromium';
}

async function getSearchBrowser() {
  if (!browserPromise) {
    const endpoint = managedPlaywrightEndpoint();
    const connect = endpoint
      ? chromium.connect(endpoint, { timeout: 15000 })
      : chromium.launch({
        headless: process.env.BROWSER_HEADLESS !== '0',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    browserPromise = connect.then(browser => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }).catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function createCollectorContext(browser) {
  if (process.env.BROWSER_REUSE_DEFAULT_CONTEXT === '1' && browser.contexts()[0]) {
    return { context: browser.contexts()[0], owned: false };
  }
  const context = await browser.newContext({
    locale: 'en-US', viewport: { width: 1440, height: 1100 },
    // Browserless residential proxying can terminate TLS with its managed CA.
    ignoreHTTPSErrors: browserConnectionMode() === 'managed-browserless',
    userAgent: process.env.META_BROWSER_USER_AGENT || undefined,
    storageState: process.env.META_BROWSER_STORAGE_STATE || undefined,
  });
  return { context, owned: true };
}

function buildAdsLibrarySearchUrl(searchTerm, options = {}) {
  const countries = Array.isArray(options.countries) ? options.countries.filter(Boolean) : [];
  const status = String(options.status || 'ACTIVE').toLowerCase() === 'all' ? 'all' : 'active';
  const requestedMedia = String(options.mediaType || 'ALL').toLowerCase();
  const media = ['video', 'image', 'all'].includes(requestedMedia) ? requestedMedia : 'all';
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', status);
  url.searchParams.set('ad_type', 'all');
  const country = (!countries.length || countries.includes('ALL'))
    ? 'ALL'
    : (countries[0] || 'ALL');
  url.searchParams.set('country', country);
  url.searchParams.set('q', String(searchTerm || '').trim());
  url.searchParams.set('search_type', 'keyword_unordered');
  url.searchParams.set('media_type', media);
  return url.href;
}

function asText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asText).find(Boolean) || '';
  if (value && typeof value === 'object') {
    // Meta changes the envelope often. These are the textual leaf keys used by
    // current snapshot, creative, and GraphQL response shapes.
    for (const key of ['text', 'value', 'text_content', 'textContent', 'name', 'title', 'body', 'description']) {
      const found = asText(value[key]);
      if (found) return found;
    }
  }
  return '';
}

function asTextArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(asTextArray).filter(Boolean))];
  const text = asText(value);
  return text ? [text] : [];
}

function asDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const raw = Number(value);
    const date = new Date(raw < 1e12 ? raw * 1000 : raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function first(object, keys) {
  for (const key of keys) if (object && object[key] != null) return object[key];
  return null;
}

function numericId(value) {
  return /^\d{1,40}$/.test(String(value || '')) ? String(value) : null;
}

function normalizePayloadAd(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
  const snapshot = object.snapshot && typeof object.snapshot === 'object' ? object.snapshot : object;
  const id = numericId(first(object, ['ad_archive_id', 'adArchiveId', 'ad_library_id', 'adLibraryId']))
    || (object.snapshot ? numericId(object.id) : null);
  if (!id) return null;
  // Preserve the field identity. In particular, don't use a generic text value
  // as a fallback for headline or description: that was causing primary text to
  // appear in every copy slot for several Meta response shapes.
  const body = first(snapshot, ['body', 'ad_creative_body', 'adCreativeBody', 'message'])
    ?? first(object, ['ad_creative_bodies', 'adCreativeBodies', 'body', 'message']);
  const title = first(snapshot, ['title', 'headline', 'link_title', 'linkTitle', 'link_headline'])
    ?? first(object, ['ad_creative_link_titles', 'adCreativeLinkTitles', 'title', 'headline', 'link_headline']);
  const caption = first(snapshot, ['caption', 'link_caption', 'linkCaption', 'link_url_caption'])
    ?? first(object, ['ad_creative_link_captions', 'adCreativeLinkCaptions', 'caption', 'link_url_caption']);
  const description = first(snapshot, ['link_description', 'linkDescription', 'description', 'link_desc'])
    ?? first(object, ['ad_creative_link_descriptions', 'adCreativeLinkDescriptions', 'description', 'link_desc']);
  const start = first(object, ['start_date', 'startDate', 'ad_delivery_start_time', 'adDeliveryStartTime', 'creation_time']);
  const stop = first(object, ['end_date', 'endDate', 'ad_delivery_stop_time', 'adDeliveryStopTime']);
  const platforms = first(object, ['publisher_platform', 'publisher_platforms', 'publisherPlatforms'])
    || first(snapshot, ['publisher_platform', 'publisher_platforms', 'publisherPlatforms']);
  const media = extractStructuredMedia(object, id);
  return {
    id,
    page_id: numericId(first(object, ['page_id', 'pageId'])) || null,
    page_name: asText(first(snapshot, ['page_name', 'pageName']))
      || asText(first(object, ['page_name', 'pageName', 'advertiser_name', 'advertiserName'])) || 'Advertiser',
    ad_creation_time: asDate(first(object, ['creation_time', 'creationTime'])) || asDate(start),
    ad_delivery_start_time: asDate(start),
    ad_delivery_stop_time: asDate(stop),
    ad_snapshot_url: `https://www.facebook.com/ads/library/?id=${id}`,
    ad_creative_bodies: asTextArray(body),
    ad_creative_link_titles: asTextArray(title),
    ad_creative_link_captions: asTextArray(caption),
    ad_creative_link_descriptions: asTextArray(description),
    publisher_platforms: asTextArray(platforms).map(value => value.toLowerCase()),
    languages: asTextArray(first(object, ['languages', 'language'])),
    eu_total_reach: first(object, ['eu_total_reach', 'euTotalReach']),
    impressions: first(object, ['impressions']),
    spend: first(object, ['spend']),
    browserMedia: media.status === 'ready' ? media : null,
  };
}

function mergeAd(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key];
    if (Array.isArray(value)) merged[key] = [...new Set([...(Array.isArray(current) ? current : []), ...value])];
    else if ((current == null || current === '' || current === 'Advertiser') && value != null && value !== '') merged[key] = value;
  }
  if (incoming.browserMedia?.creatives?.length > (existing.browserMedia?.creatives?.length || 0)) merged.browserMedia = incoming.browserMedia;
  return merged;
}

function extractAdsFromPayload(payload) {
  const ads = new Map();
  const seen = new Set();
  const stack = [payload];
  let visited = 0;
  while (stack.length && visited++ < 60000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const ad = normalizePayloadAd(value);
    if (ad) ads.set(ad.id, mergeAd(ads.get(ad.id), ad));
    stack.push(...(Array.isArray(value) ? value : Object.values(value)));
  }
  return [...ads.values()];
}

// Runs inside the page. Keep dependency-free.
function extractAdsFromDocument() {
  const results = [];
  const idsIn = node => [...new Set([...(node.innerText || '').matchAll(/(?:Library ID|Ad ID):\s*(\d+)/gi)].map(m => m[1]))];
  const leaves = [...document.querySelectorAll('span, div')].filter(node => node.childElementCount === 0
    && /^(?:Library ID|Ad ID):\s*\d+$/i.test((node.innerText || '').trim()));
  const seen = new Set();
  for (const marker of leaves) {
    const id = ((marker.innerText || '').match(/\d+/) || [])[0];
    if (!id || seen.has(id)) continue;
    let root = null;
    for (let node = marker.parentElement; node && node !== document.body; node = node.parentElement) {
      const ids = idsIn(node);
      if (ids.some(other => other !== id)) break;
      if ((node.innerText || '').length >= 80 && node.querySelector('a[href], img, video')) root = node;
    }
    if (!root) continue;
    seen.add(id);
    const lines = (root.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const startMatch = (root.innerText || '').match(/Started running on\s+([^\n]+)/i);
    const active = lines.some(line => /^Active$/i.test(line));
    const anchors = [...root.querySelectorAll('a[href]')];
    const pageLink = anchors.find(a => {
      try {
        const url = new URL(a.href);
        return /(^|\.)facebook\.com$/.test(url.hostname) && !/\/ads\/library/.test(url.pathname)
          && (a.innerText || '').trim().length > 1;
      } catch { return false; }
    });
    const ignored = /^(active|inactive|sponsored|see ad details|shop now|learn more|sign up|download|apply now|visit website|open drop-?down|this ad has multiple versions|whatsapp)$/i;
    const pageName = (pageLink?.innerText || lines.find(line => !ignored.test(line)
      && !/(?:Library ID|Started running on|platforms?)/i.test(line)))?.trim() || 'Advertiser';
    const textCandidates = lines.filter(line => line !== pageName && !ignored.test(line)
      && !/(?:Library ID|Started running on|platforms?)/i.test(line) && line.length > 12);
    const videos = [...root.querySelectorAll('video')].map(video => ({
      mediaType: 'video', videoUrl: video.currentSrc || video.src,
      videoSources: [...video.querySelectorAll('source')].map(source => source.src),
      thumbnailUrl: video.poster, width: video.videoWidth, height: video.videoHeight,
    }));
    const images = [...root.querySelectorAll('img')].map(image => ({
      mediaType: 'image', thumbnailUrl: image.currentSrc || image.src,
      width: image.naturalWidth, height: image.naturalHeight,
    })).filter(image => image.width >= 150 && image.height >= 100);
    const cta = [...root.querySelectorAll('a, button, [role="button"]')]
      .map(node => (node.innerText || '').trim()).find(text => /^(shop now|learn more|order now|get offer|sign up|download|book now|apply now|contact us|subscribe|buy now|visit website)$/i.test(text));
    results.push({ id, pageName, startDate: startMatch?.[1]?.trim() || null, active,
      body: textCandidates[0] || '', headline: textCandidates[1] || '', mediaItems: [...videos, ...images], ctaText: cta || null });
  }
  return results;
}

function domAdToRecord(ad) {
  const media = mediaResult((ad.mediaItems || []).map(item => ({ ...item, ctaText: ad.ctaText })), 'dom');
  return {
    id: String(ad.id), page_id: null, page_name: ad.pageName || 'Advertiser',
    ad_creation_time: asDate(ad.startDate), ad_delivery_start_time: asDate(ad.startDate),
    ad_delivery_stop_time: ad.active ? null : new Date().toISOString(),
    ad_snapshot_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
    ad_creative_bodies: asTextArray(ad.body), ad_creative_link_titles: asTextArray(ad.headline),
    ad_creative_link_captions: [], ad_creative_link_descriptions: [],
    publisher_platforms: ['facebook', 'instagram'], languages: [],
    browserMedia: media.status === 'ready' ? media : null,
  };
}

function parseJsonEnvelope(raw) {
  try { return JSON.parse(String(raw).replace(/^for\s*\(;;\);\s*/, '')); } catch { return null; }
}

async function dismissConsent(page) {
  for (const name of [/Allow all cookies/i, /Accept all cookies/i, /^Allow essential and optional cookies$/i]) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {}); return;
    }
  }
}

async function searchMetaAds(searchTerm, options = {}, deps = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const browser = deps.browser || await (deps.getBrowser || getSearchBrowser)();
  const { context, owned } = await createCollectorContext(browser);
  const page = await context.newPage();
  const ads = new Map();
  const pendingReads = new Set();
  let jsonReads = 0;
  let blocked = false;
  let blockReason = null;
  const collect = ad => ads.set(ad.id, mergeAd(ads.get(ad.id), ad));
  try {
    await page.route('**/*', route => route.request().resourceType() === 'font' ? route.abort() : route.continue());
    page.on('response', response => {
      const contentType = response.headers()['content-type'] || '';
      if (!response.ok() || jsonReads >= 40 || !/(?:application|text)\/json/.test(contentType)) return;
      jsonReads++;
      const read = response.text().then(raw => {
        if (raw.length > 5000000) return;
        const payload = parseJsonEnvelope(raw);
        if (payload) extractAdsFromPayload(payload).forEach(collect);
      }).catch(() => {});
      pendingReads.add(read); read.finally(() => pendingReads.delete(read));
    });
    const response = await page.goto(buildAdsLibrarySearchUrl(searchTerm, options), {
      waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS,
    });

    // Check if Meta served an initial rate-denial challenge (__rd_verify) with HTTP 403
    const initialContent = await page.content().catch(() => '');
    if (initialContent.includes('__rd_verify') || (response && response.status() === 403 && initialContent.includes('challenge'))) {
      // Allow Meta's in-page challenge script to execute and trigger automatic page reload
      await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    }

    const currentUrl = page.url();
    if (/\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(currentUrl)) {
      blocked = true;
      blockReason = `Redirected to ${currentUrl}`;
    }

    await dismissConsent(page);
    await Promise.race([
      page.locator('text=/Library ID/i').first().waitFor({ timeout: 8000 }).catch(() => {}),
      page.locator('text=/(?:No results|0 results|didn\'t match any ads)/i').first().waitFor({ timeout: 8000 }).catch(() => {}),
    ]);
    let unchanged = 0;
    let previousCount = -1;
    for (let round = 0; round < MAX_SCROLLS && ads.size < limit && !blocked; round++) {
      (await page.evaluate(extractAdsFromDocument).catch(() => [])).map(domAdToRecord).forEach(collect);
      const inlinePayloads = await page.locator('script[type="application/json"]').evaluateAll(scripts => scripts
        .map(script => script.textContent || '').filter(text => text.length > 1 && text.length < 5000000).slice(0, 40)).catch(() => []);
      for (const raw of inlinePayloads) {
        const payload = parseJsonEnvelope(raw);
        if (payload) extractAdsFromPayload(payload).forEach(collect);
      }
      const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      if (/log in to continue|security check|temporarily blocked|automated behavior/i.test(bodyText)
          || /\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())) {
        blocked = true;
        blockReason = /\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())
          ? `Redirected to ${page.url()}`
          : 'Security challenge / checkpoint detected on page';
      }
      if (ads.size === previousCount) unchanged++; else unchanged = 0;
      previousCount = ads.size;
      if (unchanged >= 3) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(900);
    }
    await Promise.allSettled([...pendingReads]);
    (await page.evaluate(extractAdsFromDocument).catch(() => [])).map(domAdToRecord).forEach(collect);
    return {
      data: [...ads.values()].slice(0, limit),
      error: blocked ? (blockReason || 'Meta blocked the browser session') : null,
      blocked,
      blockReason: blocked ? (blockReason || 'Meta blocked the browser session') : null,
    };
  } catch (error) {
    return {
      data: [...ads.values()].slice(0, limit),
      error: error.message,
      blocked,
      blockReason: blocked ? (blockReason || error.message) : null,
    };
  } finally {
    if (owned) await context.close().catch(() => {});
    else await page.close().catch(() => {});
  }
}

module.exports = { buildAdsLibrarySearchUrl, extractAdsFromPayload, extractAdsFromDocument,
  browserConnectionMode, browserlessEndpoint, managedPlaywrightEndpoint,
  createCollectorContext, getSearchBrowser, searchMetaAds };
