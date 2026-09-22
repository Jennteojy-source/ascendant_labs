/** Ad-specific creative extraction with bounded concurrency and refreshes. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cache = require('./firestore_cache');
const { mediaResult, extractStructuredMedia, inspectAdDocument, destinationUrl } = require('./media_resolver');

const envPath = path.resolve(__dirname, '../../functions/.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
  }
}

let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .then(browser => {
        browser.on('disconnected', () => { browserPromise = null; });
        return browser;
      }).catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

function snapshotTarget(adId, supplied) {
  if (!/^\d{1,40}$/.test(String(adId))) return null;
  if (supplied) {
    try {
      const url = new URL(supplied);
      if (url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname)
          || url.username || url.password || url.port
          || !/^\/ads\/(library\/?|archive\/render_ad\/?)$/.test(url.pathname)
          || url.searchParams.get('id') !== String(adId)) return null;
      return url.href;
    } catch { return null; }
  }
  const token = process.env.USER_TOKEN || process.env.META_ACCESS_TOKEN || process.env.CAPI_ACCESS_TOKEN;
  const url = new URL(token ? 'https://www.facebook.com/ads/archive/render_ad/' : 'https://www.facebook.com/ads/library/');
  url.searchParams.set('id', adId);
  if (token) url.searchParams.set('access_token', token);
  return url.href;
}

async function sniffSingleAd(browser, adId, supplied) {
  const target = snapshotTarget(adId, supplied);
  if (!target) return mediaResult([], null, 'invalid_request');
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  let structured = mediaResult([], 'structured');
  let best = mediaResult([], 'dom');
  const failedUrls = new Set();
  const reads = new Set();
  let responseReads = 0;
  const quality = media => media.creatives.reduce((score, c) => score + 100 + (c.videoUrl ? 10 : 0) + c.videoSources.length + c.imageSources.length, 0);
  const inspectJSON = raw => {
    try {
      const parsed = JSON.parse(raw.replace(/^for\s*\(;;\);\s*/, ''));
      const found = extractStructuredMedia(parsed, adId);
      if (quality(found) > quality(structured)) structured = found;
    } catch { /* Not a supported JSON envelope; never execute page scripts. */ }
  };
  try {
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest() && (url.protocol !== 'https:'
          || !(url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com')))) return route.abort();
      if (request.resourceType() === 'font') return route.abort();
      return route.continue();
    });
    page.on('response', response => {
      if (response.status() >= 400) failedUrls.add(response.url());
      const headers = response.headers();
      if (!response.ok() || !/application\/json/.test(headers['content-type'] || '') || responseReads >= 12
          || Number(headers['content-length'] || 0) > 2000000) return;
      responseReads++;
      const read = response.text().then(raw => { if (raw.length < 2000000) inspectJSON(raw); }).catch(() => {});
      reads.add(read);
      read.finally(() => reads.delete(read));
    });
    const navigation = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 12000 });
    if (navigation && [401, 403, 429].includes(navigation.status())) return mediaResult([], null, 'blocked');
    if (/\/(login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())) return mediaResult([], null, 'blocked');
    const started = Date.now();
    let signature = '';
    let stableSince = started;
    while (Date.now() - started < 8000) {
      for (const frame of page.frames()) {
        const data = await frame.evaluate(inspectAdDocument, String(adId)).catch(() => null);
        if (!data) continue;
        data.json.forEach(inspectJSON);
        const found = mediaResult(data.items.map(item => ({ ...item,
          destinationUrl: (data.links || []).map(destinationUrl).find(Boolean), ctaText: data.cta })), 'dom');
        if (found.creatives.length && (found.videoUrl || !best.videoUrl)) best = found;
      }
      const candidate = structured.creatives.length ? structured : best;
      const next = JSON.stringify(candidate.creatives);
      if (next !== signature) { signature = next; stableSince = Date.now(); }
      // Give lazy posters/video sources time to settle instead of exiting on the first image.
      const posterOnly = candidate.creatives.some(c => c.mediaType === 'video' && !c.videoUrl);
      if (candidate.creatives.length && Date.now() - stableSince >= 750
          && Date.now() - started >= (posterOnly ? 4000 : 1500)) break;
      await page.waitForTimeout(250);
    }
    const selected = structured.creatives.length ? structured : best;
    return mediaResult(selected.creatives.map(c => ({ ...c,
      videoUrl: failedUrls.has(c.videoUrl) ? null : c.videoUrl,
      videoSources: c.videoSources.filter(url => !failedUrls.has(url)),
      thumbnailUrl: failedUrls.has(c.thumbnailUrl) ? null : c.thumbnailUrl,
      imageSources: c.imageSources.filter(url => !failedUrls.has(url)),
    })), selected.source);
  } catch {
    return mediaResult([], null, 'retryable_failure');
  } finally {
    await context.close().catch(() => {});
    await Promise.allSettled([...reads]);
  }
}

// One pool per process across prewarming, simultaneous users, and refresh requests.
// Multiple Cloud Run instances still need a shared upstream budget at deployment level.
function createMediaSniffer(deps) {
  const inFlight = new Map();
  const recent = new Map();
  const waiters = [];
  const limit = Math.max(1, Math.min(4, deps.concurrency || 2));
  let active = 0;
  async function acquire() {
    if (active >= limit) await new Promise(resolve => waiters.push(resolve));
    else active++;
  }
  function release() {
    if (waiters.length) waiters.shift()();
    else active--;
  }
  return async function sniffPageMedia(adsBatch = [], { forceRefresh = false } = {}) {
    const ads = [...new Map(adsBatch.filter(a => a && /^\d{1,40}$/.test(String(a.id)))
      .slice(0, 10).map(a => [String(a.id), a])).values()];
    const cached = forceRefresh ? {} : await deps.getCachedMediaBatch(ads.map(a => String(a.id)));
    const results = {};
    await Promise.all(ads.map(async ad => {
      const id = String(ad.id);
      if (cached[id]) { results[id] = cached[id]; return; }
      if (!inFlight.has(id)) {
        const previous = recent.get(id);
        if (previous && Date.now() - previous.at < 30000 && (!forceRefresh || previous.forced)) {
          results[id] = previous.value; return;
        }
        const job = (async () => {
          await acquire();
          try {
            const browser = await deps.getBrowser();
            const value = await deps.sniffSingleAd(browser, id, ad.adSnapshotUrl);
            if (value.status === 'ready') await deps.saveMediaBatch({ [id]: value });
            recent.set(id, { at: Date.now(), value, forced: forceRefresh });
            return value;
          } catch {
            const value = mediaResult([], null, 'retryable_failure');
            recent.set(id, { at: Date.now(), value, forced: forceRefresh });
            return value;
          } finally { release(); }
        })();
        inFlight.set(id, job);
        job.finally(() => inFlight.delete(id));
      }
      results[id] = await inFlight.get(id);
    }));
    for (const [id, record] of recent) if (Date.now() - record.at > 30000) recent.delete(id);
    return results;
  };
}

const sniffPageMedia = createMediaSniffer({ ...cache, getBrowser, sniffSingleAd,
  concurrency: Number(process.env.MEDIA_SNIFF_CONCURRENCY) || 2 });
module.exports = { sniffPageMedia, getBrowser, snapshotTarget, sniffSingleAd, createMediaSniffer,
  loadCache: () => Object.fromEntries(cache.memoryCache) };
