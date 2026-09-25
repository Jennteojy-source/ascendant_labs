/** Ad-specific creative extraction with bounded concurrency and refreshes. */
const cache = require('./firestore_cache');
const { mediaResult, mediaUrl, extractStructuredMedia, inspectAdDocument, destinationUrl } = require('./media_resolver');
const { getSearchBrowser: getBrowser, getFallbackBrowser, createCollectorContext } = require('./meta_browser_searcher');
const logger = require('./gcp_logger');

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
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('id', adId);
  return url.href;
}

function searchResponseMedia(adId, supplied) {
  if (!supplied || typeof supplied !== 'object') return null;
  const allowed = value => {
    const url = mediaUrl(value);
    return url && (!url.startsWith('/api/media/') || url.startsWith(`/api/media/${adId}/`)) ? url : null;
  };
  const creatives = (Array.isArray(supplied.creatives) ? supplied.creatives : [supplied])
    .slice(0, 10).filter(item => item && typeof item === 'object').map(item => ({
      mediaType: item.mediaType,
      videoUrl: allowed(item.videoUrl),
      videoSources: (Array.isArray(item.videoSources) ? item.videoSources : []).slice(0, 4).map(allowed).filter(Boolean),
      thumbnailUrl: allowed(item.thumbnailUrl),
      imageSources: (Array.isArray(item.imageSources) ? item.imageSources : []).slice(0, 4).map(allowed).filter(Boolean),
      width: item.width, height: item.height, destinationUrl: item.destinationUrl,
      ctaText: item.ctaText, title: item.title, body: item.body, displayFormat: item.displayFormat,
    }));
  const media = mediaResult(creatives, 'search_response', 'unavailable', { displayFormat: supplied.displayFormat });
  return media.status === 'ready' ? media : null;
}

async function sniffSingleAd(browser, adId, supplied, { residential = false } = {}) {
  const target = snapshotTarget(adId, supplied);
  if (!target) return mediaResult([], null, 'invalid_request');
  const { context, owned } = await createCollectorContext(browser, { residential });
  const page = await context.newPage();
  let structured = mediaResult([], 'structured');
  let best = mediaResult([], 'dom');
  const failedUrls = new Set();
  const reads = new Set();
  let responseReads = 0;
  let detailHttpStatus = null;
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
    detailHttpStatus = navigation?.status() || null;
    const isBlockedPage = async response => Boolean((response && [401, 403, 429].includes(response.status()))
      || /\/(login|checkpoint|challenge)(?:\/|\?|$)/.test(page.url())
      || /log in to continue|security check|temporarily blocked|automated behavior/i.test(
        await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')));
    let blocked = await isBlockedPage(navigation);
    const started = Date.now();
    let signature = '';
    let stableSince = started;
    while (!blocked && Date.now() - started < 8000) {
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
    // Some ads expose the creative only in Meta's dedicated render document.
    // Visit it only when the regular Library detail supplied no usable media.
    if (!structured.creatives.length && !best.creatives.length) {
      const renderUrl = `https://www.facebook.com/ads/archive/render_ad/?id=${encodeURIComponent(adId)}`;
      const renderNavigation = await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
      if (renderNavigation) detailHttpStatus = renderNavigation.status();
      blocked = blocked || await isBlockedPage(renderNavigation);
      const fallbackStarted = Date.now();
      while (!blocked && Date.now() - fallbackStarted < 4000 && !structured.creatives.length && !best.creatives.length) {
        for (const frame of page.frames()) {
          const data = await frame.evaluate(inspectAdDocument, String(adId)).catch(() => null);
          if (!data) continue;
          data.json.forEach(inspectJSON);
          const found = mediaResult(data.items.map(item => ({ ...item,
            destinationUrl: (data.links || []).map(destinationUrl).find(Boolean), ctaText: data.cta })), 'dom');
          if (found.creatives.length) best = found;
        }
        if (!structured.creatives.length && !best.creatives.length) await page.waitForTimeout(250);
      }
    }
    await Promise.race([Promise.allSettled([...reads]), page.waitForTimeout(1000)]);
    const selected = structured.creatives.length ? structured : best;
    if (!selected.creatives.length) blocked = blocked || await isBlockedPage(null);
    if (!selected.creatives.length && blocked) return {
      ...mediaResult([], null, 'blocked'),
      diagnostic: { httpStatus: detailHttpStatus, reason: detailHttpStatus === 403 ? 'meta_http_403' : 'meta_challenge' },
    };
    return mediaResult(selected.creatives.map(c => ({ ...c,
      videoUrl: failedUrls.has(c.videoUrl) ? null : c.videoUrl,
      videoSources: c.videoSources.filter(url => !failedUrls.has(url)),
      thumbnailUrl: failedUrls.has(c.thumbnailUrl) ? null : c.thumbnailUrl,
      imageSources: c.imageSources.filter(url => !failedUrls.has(url)),
    })), selected.source);
  } catch (error) {
    logger.warn('Ad detail extraction failed', {
      adId: String(adId),
      errorType: error.name || 'Error', reason: String(error.message || '').slice(0, 200),
    });
    return { ...mediaResult([], null, 'retryable_failure'),
      diagnostic: { httpStatus: detailHttpStatus, reason: error.name === 'TimeoutError' ? 'timeout' : 'collector_error' } };
  } finally {
    if (owned) await context.close().catch(() => {});
    else await page.close().catch(() => {});
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
            const startedAt = Date.now();
            let value = !forceRefresh && searchResponseMedia(id, ad.media);
            if (!value) {
              const browser = await deps.getBrowser();
              value = await deps.sniffSingleAd(browser, id, ad.adSnapshotUrl);
            }

            // Fallback to Browserless residential proxy only if primary browser was blocked by Meta
            if (value.status === 'blocked' && deps.enableResidentialFallback && deps.getFallbackBrowser) {
              const fallbackStartedAt = Date.now();
              logger.warn('⚠️ Ad detail sniffing blocked on primary browser; falling back to Browserless residential proxy', {
                adId: id,
                status: 'SNIFF_FALLBACK_INITIATED',
              });
              let fallbackBrowser;
              try {
                fallbackBrowser = await deps.getFallbackBrowser();
                if (fallbackBrowser) {
                  const fallbackValue = await deps.sniffSingleAd(fallbackBrowser, id, ad.adSnapshotUrl, { residential: true });
                  if (fallbackValue.status === 'ready') {
                    value = fallbackValue;
                    logger.info('✅ Ad detail sniffing SUCCEEDED via Browserless residential proxy', {
                      adId: id,
                      creativeCount: value.creatives?.length || 0,
                      durationMs: Date.now() - fallbackStartedAt,
                      status: 'SNIFF_FALLBACK_SUCCESS',
                    });
                  } else {
                    logger.error('❌ Ad detail sniffing failed or blocked via Browserless residential proxy', {
                      adId: id,
                      status: fallbackValue.status,
                      durationMs: Date.now() - fallbackStartedAt,
                    });
                  }
                }
              } catch (fallbackErr) {
                logger.error('❌ Ad detail sniffing Browserless fallback error', {
                  adId: id,
                  error: fallbackErr.message,
                });
              } finally {
                if (fallbackBrowser) await fallbackBrowser.close().catch(() => {});
              }
            }

            if (value.status === 'ready') await deps.saveMediaBatch({ [id]: value });
            recent.set(id, { at: Date.now(), value, forced: forceRefresh });
            logger.info('Ad media extraction completed', {
              adId: id, status: value.status, source: value.source || null,
              creativeCount: value.creatives?.length || 0,
              durationMs: Date.now() - startedAt,
            });
            return value;
          } catch (error) {
            const value = mediaResult([], null, 'retryable_failure');
            recent.set(id, { at: Date.now(), value, forced: forceRefresh });
            logger.warn('Ad media extraction failed', { adId: id,
              errorType: error.name || 'Error', reason: String(error.message || '').slice(0, 200) });
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

const sniffPageMedia = createMediaSniffer({ ...cache, getBrowser, getFallbackBrowser, sniffSingleAd,
  enableResidentialFallback: process.env.MEDIA_SNIFF_RESIDENTIAL_FALLBACK === '1',
  concurrency: Number(process.env.MEDIA_SNIFF_CONCURRENCY) || 2 });
module.exports = { sniffPageMedia, getBrowser, getFallbackBrowser, snapshotTarget, sniffSingleAd, createMediaSniffer,
  searchResponseMedia,
  loadCache: () => Object.fromEntries(cache.memoryCache) };
