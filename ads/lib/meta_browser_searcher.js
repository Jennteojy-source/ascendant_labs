/**
 * Public Meta Ads Library collector.
 *
 * Uses the public browser experience instead of the Graph/Ads Library API.
 * Extraction is layered: structured JSON first, visible DOM second.
 */
const { chromium } = require('playwright');
const { extractStructuredMedia, mediaResult } = require('./media_resolver');
const logger = require('./gcp_logger');

const SEARCH_TIMEOUT_MS = 30000;
const BROWSER_LAUNCH_TIMEOUT_MS = Math.max(30000, Number(process.env.BROWSER_LAUNCH_TIMEOUT_MS) || 45000);
// Ads Library initially renders a complete screenful of cards. Eight bounded
// passes capture lazy-loaded results without paying for a long browser session.
const MAX_SCROLLS = 8;
const SCROLL_SETTLE_MS = 550;
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
  const endpoint = env.BROWSER_WS_ENDPOINT
    || (env.BROWSERLESS_PRIMARY === '1' ? browserlessEndpoint(env) : null);
  if (!endpoint) return null;
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'wss:') {
    throw new Error('Managed browser endpoint must use encrypted wss:// transport');
  }
  return parsed.href;
}

function browserConnectionMode(env = process.env) {
  if (env.BROWSER_WS_ENDPOINT) return 'managed-playwright';
  if (env.BROWSERLESS_PRIMARY === '1' && (env.BROWSERLESS_TOKEN || env.BROWSERLESS_API)) return 'managed-browserless';
  return 'local-chromium';
}

async function getSearchBrowser() {
  if (!browserPromise) {
    const endpoint = managedPlaywrightEndpoint();
    const connect = endpoint
      ? chromium.connect(endpoint, { timeout: 15000 })
      : chromium.launch({
        headless: process.env.BROWSER_HEADLESS !== '0',
        // Keep Chromium dependable in a serverless Linux sandbox.
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking'],
        timeout: BROWSER_LAUNCH_TIMEOUT_MS,
      });
    browserPromise = connect.then(browser => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }).catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function getFallbackBrowser() {
  const endpoint = browserlessEndpoint();
  if (!endpoint) return null;
  return chromium.connect(endpoint, { timeout: 15000 });
}

async function createCollectorContext(browser, { residential = false } = {}) {
  if (process.env.BROWSER_REUSE_DEFAULT_CONTEXT === '1' && browser.contexts()[0]) {
    return { context: browser.contexts()[0], owned: false };
  }
  const context = await browser.newContext({
    locale: 'en-US', viewport: { width: 1440, height: 1100 },
    // The collector reads DOM and XHR payloads itself. Blocking service workers
    // makes those requests visible to Playwright's routing/response handlers.
    serviceWorkers: 'block',
    // Optional managed-browser mode may use its own TLS interception CA.
    ignoreHTTPSErrors: residential || browserConnectionMode() === 'managed-browserless',
    userAgent: process.env.META_BROWSER_USER_AGENT
      || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    storageState: process.env.META_BROWSER_STORAGE_STATE || undefined,
  });
  return { context, owned: true };
}

function buildAdsLibrarySearchUrl(searchTerm, options = {}) {
  const countries = Array.isArray(options.countries) ? options.countries.filter(Boolean) : [];
  const status = String(options.status || 'ACTIVE').toLowerCase() === 'all' ? 'all' : 'active';
  const requestedMedia = String(options.mediaType || 'ALL').toLowerCase();
  const media = ['video', 'image', 'all'].includes(requestedMedia) ? requestedMedia : 'all';
  const searchType = String(options.searchType || 'keyword_unordered').toLowerCase() === 'keyword_exact_phrase'
    ? 'keyword_exact_phrase' : 'keyword_unordered';
  const pageId = numericId(options.pageId);
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', status);
  url.searchParams.set('ad_type', 'all');
  const country = (!countries.length || countries.includes('ALL'))
    ? 'ALL'
    : (countries[0] || 'ALL');
  url.searchParams.set('country', country);
  if (pageId) {
    url.searchParams.set('search_type', 'page');
    url.searchParams.set('view_all_page_id', pageId);
  } else {
    url.searchParams.set('q', String(searchTerm || '').trim());
    url.searchParams.set('search_type', searchType);
  }
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

function isInvalidAdText(text) {
  if (!text || typeof text !== 'string') return true;
  const s = text.trim();
  if (s.length === 0) return true;
  if (/^\{\{[^}]+\}\}$/.test(s) || /\{\{product\./i.test(s)) return true;
  if (/^(?:null|undefined|none|n\/a|\{\}|\[\])$/i.test(s)) return true;
  if (/\b\d+\s+ads?\s+use\s+this\s+creative/i.test(s)) return true;
  if (/\b(?:EU\s+)?transparency\b/i.test(s) && s.length < 40) return true;
  if (/^(?:active|inactive|sponsored|report\s+ad|see\s+ad\s+details|about\s+the\s+advertiser|this\s+ad\s+has\s+multiple\s+versions|multiple\s+versions)$/i.test(s)) return true;
  if (/^(?:meta\s+)?ad\s+library$|^see\s+summary\s+details$|^estimated\s+audience\s+size:?$|^amount\s+spent(?:\s*\([^)]*\))?:?$|^categories$|^impressions:?$|^see\s+more$|^log\s*in$|^log\s*out$|^sign\s*up$|^search\s+ads$|^filter\s+results$/i.test(s)) return true;
  if (/^this ad was run by an account or page we later disabled/i.test(s)) return true;
  if (/^sorry, we're having trouble playing this video\.?$/i.test(s)) return true;
  if (/^(?:Started\s+running\s+on\s+|Library\s+ID:\s*)\d+/i.test(s)) return true;
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*[-–—~to\s]+(?:\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|present)$/i.test(s)) return true;
  if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—~to\s]+(?:\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|present)$/i.test(s)) return true;
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s*[-–—~to\s]+\s*\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return false;
}

function asTextArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(asTextArray).filter(v => v && !isInvalidAdText(v)))];
  const text = asText(value);
  return text && !isInvalidAdText(text) ? [text] : [];
}

function findValidAdCopy(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const val = source[key];
      if (val == null) continue;
      const arr = asTextArray(val);
      if (arr.length > 0) return arr;
    }
  }
  return [];
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
  // Search prioritized candidate sources (card first, snapshot second, root third)
  // for the first non-junk copy text for each distinct slot.
  const firstCard = Array.isArray(snapshot.cards) ? snapshot.cards[0] : null;
  const bodies = findValidAdCopy([firstCard, snapshot, object], ['body', 'ad_creative_body', 'adCreativeBody', 'message', 'ad_creative_bodies', 'adCreativeBodies']);
  const titles = findValidAdCopy([firstCard, snapshot, object], ['link_title', 'linkTitle', 'link_headline', 'headline', 'title', 'ad_creative_link_titles', 'adCreativeLinkTitles']);
  const captions = findValidAdCopy([firstCard, snapshot, object], ['caption', 'link_caption', 'linkCaption', 'link_url_caption', 'ad_creative_link_captions', 'adCreativeLinkCaptions']);
  const descriptions = findValidAdCopy([firstCard, snapshot, object], ['link_description', 'linkDescription', 'description', 'link_desc', 'ad_creative_link_descriptions', 'adCreativeLinkDescriptions']);
  const start = first(object, ['start_date', 'startDate', 'ad_delivery_start_time', 'adDeliveryStartTime', 'creation_time']);
  const stop = first(object, ['end_date', 'endDate', 'ad_delivery_stop_time', 'adDeliveryStopTime']);
  const platforms = first(object, ['publisher_platform', 'publisher_platforms', 'publisherPlatforms'])
    || first(snapshot, ['publisher_platform', 'publisher_platforms', 'publisherPlatforms']);
  const perAd = keys => {
    for (const source of [object, snapshot]) {
      for (const key of keys) {
        const value = source?.[key];
        if (Array.isArray(value) && value.length) return value;
        if (value && !Array.isArray(value)) return [value];
      }
    }
    return [];
  };
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
    ad_creative_bodies: bodies,
    ad_creative_link_titles: titles,
    ad_creative_link_captions: captions,
    ad_creative_link_descriptions: descriptions,
    publisher_platforms: asTextArray(platforms).map(value => value.toLowerCase()),
    languages: asTextArray(first(object, ['languages', 'language'])),
    reached_countries: perAd(['reached_countries', 'reachedCountries', 'ad_reached_countries', 'adReachedCountries']),
    target_countries: perAd(['target_countries', 'targetCountries']),
    target_locations: perAd(['target_locations', 'targetLocations']),
    targeted_or_reached_countries: perAd(['targeted_or_reached_countries', 'targetedOrReachedCountries']),
    age_country_gender_reach_breakdown: perAd(['age_country_gender_reach_breakdown', 'ageCountryGenderReachBreakdown']),
    eu_total_reach: first(object, ['eu_total_reach', 'euTotalReach']),
    impressions: first(object, ['impressions']),
    spend: first(object, ['spend']),
    display_format: first(snapshot, ['display_format', 'displayFormat']) || first(object, ['display_format', 'displayFormat']) || null,
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
  const creativeImage = image => {
    const rect = image.getBoundingClientRect();
    const src = image.currentSrc || image.src || '';
    return rect.width >= 120 && rect.height >= 100
      && /https:\/\/[^/]*\.(?:fbcdn\.net|fbsbx\.com)\//i.test(src)
      && !/(?:s60x60|s150x150|s206x206|p50x50|p100x100|profile_pic|t51\.82787|_8nqq)/i.test(src)
      && !/profile|avatar|logo/i.test(image.alt || '');
  };
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
      // The nearest complete card keeps navigation and neighbouring ads out of copy.
      if ((node.innerText || '').length >= 60
          && (node.querySelector('video') || [...node.querySelectorAll('img')].some(creativeImage))) {
        root = node; break;
      }
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
    const ignored = /^(active|inactive|sponsored|see ad details|shop now|learn more|sign up|download|apply now|visit website|open drop-?down|this ad has multiple versions|whatsapp|eu transparency|report ad|(?:meta\s+)?ad library|see summary details|estimated audience size:?|amount spent(?:\s*\([^)]*\))?:?|categories|impressions:?|log\s*in|log\s*out)$/i;
    const isBadCopy = text => {
      const s = (text || '').trim();
      if (!s || s.length < 3) return true;
      if (/^\{\{[^}]+\}\}$/.test(s) || /\{\{product\./i.test(s)) return true;
      if (/^(?:null|undefined|none|n\/a|\{\}|\[\])$/i.test(s)) return true;
      if (/\b\d+\s+ads?\s+use\s+this\s+creative/i.test(s)) return true;
      if (/\b(?:EU\s+)?transparency\b/i.test(s) && s.length < 40) return true;
      if (/^(?:active|inactive|sponsored|report\s+ad|see\s+ad\s+details|about\s+the\s+advertiser|this\s+ad\s+has\s+multiple\s+versions|multiple\s+versions)$/i.test(s)) return true;
      if (/^(?:meta\s+)?ad\s+library$|^see\s+summary\s+details$|^estimated\s+audience\s+size:?$|^amount\s+spent(?:\s*\([^)]*\))?:?$|^categories$|^impressions:?$|^log\s*in$|^log\s*out$/i.test(s)) return true;
      if (/^this ad was run by an account or page we later disabled/i.test(s)) return true;
      if (/^sorry, we're having trouble playing this video\.?$/i.test(s)) return true;
      if (/^(?:Started\s+running\s+on\s+|Library\s+ID:\s*)\d+/i.test(s)) return true;
      if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*[-–—~to\s]+(?:\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|present)$/i.test(s)) return true;
      if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—~to\s]+(?:\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|present)$/i.test(s)) return true;
      if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(s)) return true;
      if (/^\d{4}-\d{2}-\d{2}\s*[-–—~to\s]+\s*\d{4}-\d{2}-\d{2}$/.test(s)) return true;
      return false;
    };
    const pageName = (pageLink?.innerText || lines.find(line => !ignored.test(line)
      && !/(?:Library ID|Started running on|platforms?)/i.test(line) && !isBadCopy(line)))?.trim() || 'Advertiser';
    const textCandidates = lines.filter(line => line !== pageName && !ignored.test(line)
      && !/(?:Library ID|Started running on|platforms?)/i.test(line) && !isBadCopy(line));
    const videos = [...root.querySelectorAll('video')].map(video => ({
      mediaType: 'video', videoUrl: video.currentSrc || video.src,
      videoSources: [...video.querySelectorAll('source')].map(source => source.src),
      thumbnailUrl: video.poster, width: video.videoWidth, height: video.videoHeight,
    }));
    // Search deliberately aborts image downloads. Use the rendered slot and
    // ad-scoped URL rather than naturalWidth, which stays zero in that case.
    const images = [...root.querySelectorAll('img')].filter(creativeImage).map(image => ({
      mediaType: 'image', thumbnailUrl: image.currentSrc || image.src,
      width: image.naturalWidth || Math.round(image.getBoundingClientRect().width),
      height: image.naturalHeight || Math.round(image.getBoundingClientRect().height),
    }));
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
    publisher_platforms: [], languages: [],
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

async function discoverMetaPages(searchTerm, options = {}, deps = {}) {
  const timeoutMs = Math.max(5000, Math.min(12000, Number(options.timeoutMs) || 10000));
  const startedAt = Date.now();
  const browser = deps.browser || await (deps.getBrowser || getSearchBrowser)();
  const { context, owned } = await createCollectorContext(browser);
  const page = await context.newPage();
  try {
    await page.route('**/*', route => ['font', 'image', 'media'].includes(route.request().resourceType())
      ? route.abort() : route.continue());
    await page.goto(buildAdsLibrarySearchUrl(searchTerm, { countries: ['ALL'], status: 'ALL' }),
      { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await dismissConsent(page);
    const input = page.locator('input[placeholder="Search by keyword or advertiser"]').first();
    await input.waitFor({ timeout: Math.min(5000, timeoutMs) });
    await input.click({ force: true, timeout: 3000 });
    await input.selectText().catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.type(searchTerm, { delay: 75 });
    const optionsList = page.locator('li[role="option"][id^="pageID:"]');
    await optionsList.first().waitFor({ timeout: Math.max(1000, timeoutMs - (Date.now() - startedAt)) })
      .catch(() => {});
    const candidates = await optionsList.evaluateAll(nodes => nodes.slice(0, 10).map(node => {
      const pageId = (node.id.match(/^pageID:(\d+)$/) || [])[1] || null;
      const textLines = (node.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
      const name = textLines[0] || node.querySelector('[role="heading"]')?.textContent?.trim() || '';
      const details = textLines.slice(1).join(' · ').slice(0, 180);
      return { pageId, name, details };
    }).filter(item => item.pageId && item.name));
    const bodySample = candidates.length ? null
      : (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 180);
    logger.info('Meta advertiser suggestions collected', {
      query: searchTerm, count: candidates.length, bodySample,
      inputValue: candidates.length ? null : await input.inputValue().catch(() => null),
      pageUrl: candidates.length ? null : page.url(),
      durationMs: Date.now() - startedAt,
    });
    return candidates;
  } catch (error) {
    logger.warn('Meta advertiser discovery failed', {
      query: searchTerm, errorType: error.name || 'Error',
      reason: String(error.message || '').slice(0, 160), durationMs: Date.now() - startedAt,
    });
    return [];
  } finally {
    if (owned) await context.close().catch(() => {});
    else await page.close().catch(() => {});
  }
}

async function executeBrowserSearch(browser, searchTerm, options = {}, { residential = false } = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const timeoutMs = Math.max(5000, Math.min(SEARCH_TIMEOUT_MS, Number(options.timeoutMs) || SEARCH_TIMEOUT_MS));
  const startedAt = Date.now();
  const timeLeft = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
  const { context, owned } = await createCollectorContext(browser, { residential });
  const page = await context.newPage();
  const ads = new Map();
  const pendingReads = new Set();
  let jsonReads = 0;
  let blocked = false;
  let blockReason = null;
  let lastBodyText = '';
  let navigationStatus = null;
  const collect = ad => ads.set(ad.id, mergeAd(ads.get(ad.id), ad));
  try {
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      return ['font', 'image', 'media'].includes(type) ? route.abort() : route.continue();
    });
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
      waitUntil: 'domcontentloaded', timeout: timeoutMs,
    });
    navigationStatus = response?.status() || null;

    // Check if Meta served an initial rate-denial challenge (__rd_verify) with HTTP 403
    const challengeMarker = await page.evaluate(() => {
      const html = document.documentElement?.innerHTML || '';
      return { verify: html.includes('__rd_verify'), challenge: html.includes('challenge') };
    }).catch(() => ({ verify: false, challenge: false }));
    if (challengeMarker.verify || (response?.status() === 403 && challengeMarker.challenge)) {
      await page.waitForNavigation({ timeout: Math.min(3000, timeLeft()) }).catch(() => {});
    }

    const currentUrl = page.url();
    if (/\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(currentUrl) || navigationStatus === 403 || navigationStatus === 429) {
      blocked = true;
      blockReason = (navigationStatus === 403 || navigationStatus === 429)
        ? `HTTP ${navigationStatus} ${navigationStatus === 403 ? 'Forbidden' : 'Rate Limited'} by Meta`
        : `Redirected to ${currentUrl}`;
      return {
        data: [],
        error: blockReason,
        blocked: true,
        inconclusive: false,
        blockReason,
      };
    }

    await dismissConsent(page);
    if (timeLeft() > 1000) await Promise.race([
      page.locator('text=/Library ID/i').first().waitFor({ timeout: Math.min(8500, timeLeft()) }).catch(() => {}),
      page.locator('text=/(?:No results|0 results|didn\'t match any ads)/i').first().waitFor({ timeout: Math.min(8500, timeLeft()) }).catch(() => {}),
    ]);
    let unchanged = 0;
    let previousCount = -1;
    for (let round = 0; round < MAX_SCROLLS && ads.size < limit && !blocked && Date.now() - startedAt < timeoutMs; round++) {
      (await page.evaluate(extractAdsFromDocument).catch(() => [])).map(domAdToRecord).forEach(collect);
      const inlinePayloads = await page.locator('script[type="application/json"]').evaluateAll(scripts => scripts
        .map(script => script.textContent || '').filter(text => text.length > 1 && text.length < 5000000).slice(0, 40)).catch(() => []);
      for (const raw of inlinePayloads) {
        const payload = parseJsonEnvelope(raw);
        if (payload) extractAdsFromPayload(payload).forEach(collect);
      }
      const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
      lastBodyText = bodyText;
      if (/log in to continue|security check|temporarily blocked|automated behavior/i.test(bodyText)
          || /\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())) {
        blocked = true;
        blockReason = /\/(?:login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())
          ? `Redirected to ${page.url()}`
          : 'Security challenge / checkpoint detected on page';
      }
      if (ads.size === previousCount) unchanged++; else unchanged = 0;
      previousCount = ads.size;
      const explicitEmpty = /(?:^|\n)\s*(?:no ads found|no results|0 results|your search didn't match any ads)/i.test(bodyText);
      if (unchanged >= 3 && (ads.size > 0 || explicitEmpty || Date.now() - startedAt >= Math.min(13000, timeoutMs - 1000))) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(SCROLL_SETTLE_MS);
    }
    await Promise.race([Promise.allSettled([...pendingReads]), page.waitForTimeout(Math.min(1000, timeLeft()))]);
    (await page.evaluate(extractAdsFromDocument).catch(() => [])).map(domAdToRecord).forEach(collect);
    const explicitEmpty = /(?:^|\n)\s*(?:no ads found|no results|0 results|your search didn't match any ads)/i.test(lastBodyText);
    const inconclusive = !ads.size && !blocked && !explicitEmpty;
    if (inconclusive) logger.warn('Meta search page did not yield result cards', {
      query: searchTerm, navigationStatus, jsonReads,
      resultHeading: (lastBodyText.match(/~?\s*[\d,]+\s+results?/i) || [])[0] || null,
      bodySample: lastBodyText.slice(0, 180), durationMs: Date.now() - startedAt,
    });
    return {
      data: [...ads.values()].slice(0, limit),
      error: blocked ? (blockReason || 'Meta blocked the browser session')
        : (inconclusive ? 'Meta search page did not finish loading result cards' : null),
      blocked,
      inconclusive,
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

let primaryCircuitOpenUntil = 0;

async function searchMetaAds(searchTerm, options = {}, deps = {}) {
  // If a specific browser was explicitly supplied, use it directly
  if (deps.browser) {
    return executeBrowserSearch(deps.browser, searchTerm, options);
  }

  const fallbackEndpoint = browserlessEndpoint();
  const isCircuitOpen = Boolean(fallbackEndpoint && Date.now() < primaryCircuitOpenUntil);

  let primaryResult = null;
  if (!isCircuitOpen) {
    // 1. Try Primary Cloud Run / Local Chromium first (0 marginal cost)
    const primaryBrowser = await (deps.getBrowser || getSearchBrowser)();
    primaryResult = await executeBrowserSearch(primaryBrowser, searchTerm, options);

    const isBlocked = Boolean(primaryResult.blocked || /blocked|checkpoint|challenge|403|rate limit/i.test(primaryResult.error || ''));
    if (!isBlocked && (!primaryResult.error || primaryResult.data?.length > 0)) {
      return primaryResult;
    }

    if (isBlocked && fallbackEndpoint) {
      primaryCircuitOpenUntil = Date.now() + 5 * 60 * 1000;
    }
  }

  // 2. Check if Browserless fallback is configured
  if (!fallbackEndpoint) {
    if (primaryResult?.blocked) {
      logger.warn('Meta blocked primary browser, but no Browserless fallback credentials configured', {
        query: searchTerm,
        blockReason: primaryResult.blockReason || primaryResult.error,
      });
    }
    return primaryResult || { data: [], error: 'Primary browser failed and no Browserless fallback configured', blocked: true };
  }

  // 3. Fallback to managed Browserless with residential proxy
  const fallbackStartedAt = Date.now();
  if (isCircuitOpen) {
    logger.info('Primary browser circuit open (datacenter IP blocked); routing directly to Browserless residential proxy', {
      query: searchTerm,
      circuitRemainingSec: Math.round((primaryCircuitOpenUntil - Date.now()) / 1000),
    });
  } else {
    logger.warn('⚠️ Primary Cloud Run browser blocked by Meta or failed; falling back to managed Browserless residential proxy', {
      query: searchTerm,
      primaryBlocked: Boolean(primaryResult?.blocked),
      blockReason: primaryResult?.blockReason || primaryResult?.error,
      action: 'FALLBACK_INITIATED',
    });
  }

  let fallbackBrowser;
  try {
    fallbackBrowser = await (deps.getFallbackBrowser || getFallbackBrowser)();
    if (!fallbackBrowser) throw new Error('Could not establish Browserless fallback connection');

    const fallbackResult = await executeBrowserSearch(fallbackBrowser, searchTerm, options, { residential: true });
    const durationMs = Date.now() - fallbackStartedAt;

    if (fallbackResult.blocked || (fallbackResult.error && !fallbackResult.data?.length)) {
      logger.error('❌ Browserless residential fallback FAILED or blocked by Meta', {
        query: searchTerm,
        blocked: Boolean(fallbackResult.blocked),
        error: fallbackResult.error,
        blockReason: fallbackResult.blockReason,
        durationMs,
        action: 'FALLBACK_FAILED',
      });
      return fallbackResult;
    }

    logger.info('✅ Browserless residential fallback SUCCEEDED', {
      query: searchTerm,
      adsFound: fallbackResult.data.length,
      durationMs,
      status: 'FALLBACK_SUCCESS',
      collector: 'managed-browserless',
    });

    return {
      ...fallbackResult,
      resolvedByFallback: true,
      collector: 'managed-browserless',
    };
  } catch (err) {
    logger.error('❌ Browserless residential fallback encountered exception', {
      query: searchTerm,
      error: err.message,
      durationMs: Date.now() - fallbackStartedAt,
      action: 'FALLBACK_ERROR',
    });
    return primaryResult;
  } finally {
    if (fallbackBrowser) {
      await fallbackBrowser.close().catch(() => {});
    }
  }
}

module.exports = { buildAdsLibrarySearchUrl, extractAdsFromPayload, extractAdsFromDocument,
  browserConnectionMode, browserlessEndpoint, managedPlaywrightEndpoint,
  createCollectorContext, getSearchBrowser, getFallbackBrowser, searchMetaAds, discoverMetaPages };
