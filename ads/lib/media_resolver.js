// Pure extraction/validation shared by the collector, cache, and regression tests.
const MEDIA_SCHEMA_VERSION = 2;
const MEDIA_CACHE_TTL_MS = 60 * 60 * 1000;

function httpUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/&amp;/g, '&');
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? raw : null;
  } catch { return null; }
}

function isAvatarUrl(value) {
  return /(?:s60x60|s150x150|s206x206|p50x50|p100x100|profile_pic|t51\.82787|_8nqq)/i.test(value || '');
}

function mediaUrl(value) {
  const raw = httpUrl(value);
  if (!raw) return null;
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && ['fbcdn.net', 'fbsbx.com'].some(d => host === d || host.endsWith(`.${d}`))
    && !/rsrc\.php|hsts-pixel|profile_pic/i.test(raw) ? raw : null;
}

function isUrlExpired(value, now = Date.now()) {
  if (!value) return false;
  try {
    const hint = new URL(value).searchParams.get('oe');
    return !!hint && /^[\da-f]+$/i.test(hint) && parseInt(hint, 16) * 1000 <= now + 60000;
  } catch { return true; }
}

function destinationUrl(value) {
  let raw = httpUrl(value);
  if (!raw) return null;
  let url = new URL(raw);
  if (['l.facebook.com', 'lm.facebook.com'].includes(url.hostname) && url.pathname === '/l.php') {
    // URLSearchParams already decodes this once; decoding again corrupts signed destinations.
    raw = httpUrl(url.searchParams.get('u'));
    if (!raw) return null;
    url = new URL(raw);
  }
  return ['facebook.com', 'fbcdn.net', 'fbsbx.com'].some(d => url.hostname === d || url.hostname.endsWith(`.${d}`)) ? null : raw;
}

function normalizeCreative(item) {
  const videoSources = [...new Set([item.videoUrl, ...(item.videoSources || [])].map(mediaUrl).filter(v => v && !isUrlExpired(v)))];
  const imageSources = [...new Set([item.thumbnailUrl, ...(item.imageSources || [])].map(mediaUrl).filter(v => v && !isAvatarUrl(v) && !isUrlExpired(v)))];
  if (!videoSources.length && !imageSources.length) return null;
  return {
    mediaType: item.videoUrl || item.videoSources?.some(Boolean) || item.mediaType === 'video' ? 'video' : 'image',
    videoUrl: videoSources[0] || null, videoSources,
    thumbnailUrl: imageSources[0] || null, imageSources,
    width: Number(item.width) > 0 ? Number(item.width) : null,
    height: Number(item.height) > 0 ? Number(item.height) : null,
    destinationUrl: destinationUrl(item.destinationUrl),
    ctaText: typeof item.ctaText === 'string' ? item.ctaText.slice(0, 100) : null,
  };
}

function mediaResult(items, source, status = 'unavailable') {
  const seen = new Set();
  const creatives = items.map(normalizeCreative).filter(c => {
    if (!c) return false;
    const key = `${c.videoUrl || ''}|${c.thumbnailUrl || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION, source,
    status: creatives.length ? 'ready' : status,
    ...(creatives[0] || { mediaType: 'unknown', thumbnailUrl: null, videoUrl: null }),
    creatives,
  };
}

function extractStructuredMedia(payload, adId) {
  const items = [];
  let visited = 0;
  const read = (object) => {
    if (!object || typeof object !== 'object') return;
    const videoSources = [object.video_sd_url, object.videoSdUrl, object.video_hd_url, object.videoHdUrl];
    const imageSources = [object.video_preview_image_url, object.videoPreviewImageUrl,
      object.resized_image_url, object.resizedImageUrl, object.original_image_url, object.originalImageUrl];
    const creative = normalizeCreative({
      videoSources, imageSources,
      mediaType: videoSources.some(Boolean) || object.video_preview_image_url || object.videoPreviewImageUrl ? 'video' : 'image',
      destinationUrl: object.link_url || object.linkUrl,
      ctaText: object.cta_text || object.ctaText,
      width: object.width, height: object.height,
    });
    if (creative) items.push(creative);
    // Only known creative collections; never recursively harvest arbitrary profile assets.
    for (const key of ['cards', 'videos', 'images']) {
      if (Array.isArray(object[key])) object[key].forEach(read);
    }
  };
  const walk = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 50 || ++visited > 20000) return;
    const id = value.ad_archive_id ?? value.adArchiveID ?? value.ad_archiveId;
    if (id != null) {
      if (String(id) === String(adId)) read(value.snapshot || value);
      return; // A different ad's subtree is not evidence for this ad.
    }
    Object.values(value).forEach(v => walk(v, depth + 1));
  };
  walk(payload);
  return mediaResult(items, 'structured');
}

// Runs inside a Playwright frame. Keep self-contained (no Node closures).
function inspectAdDocument(adId) {
  const idFromLink = href => {
    try {
      const u = new URL(href, location.href);
      return /\/ads\/(?:library|archive\/render_ad)/.test(u.pathname) ? u.searchParams.get('id') : null;
    } catch { return null; }
  };
  const matches = [...document.querySelectorAll('[data-ad-id], [data-ad-archive-id]')]
    .filter(el => (el.getAttribute('data-ad-id') || el.getAttribute('data-ad-archive-id')) === adId);
  let root = matches[0];
  const idsWithin = el => new Set([
    ...[...el.querySelectorAll('a[href]')].map(a => idFromLink(a.href)),
    ...[...el.querySelectorAll('[data-ad-id], [data-ad-archive-id]')]
      .map(node => node.getAttribute('data-ad-id') || node.getAttribute('data-ad-archive-id')),
    ...[...(el.innerText || el.body?.innerText || '').matchAll(/(?:Library ID|Ad ID):\s*(\d+)/gi)].map(match => match[1]),
  ].filter(Boolean));
  if (!root) {
    const marker = [...document.querySelectorAll('a[href]')].find(a => idFromLink(a.href) === adId)
      || [...document.querySelectorAll('span, div')].find(el => el.childElementCount === 0
        && new RegExp(`^(?:Library ID|Ad ID):\\s*${adId}$`, 'i').test((el.innerText || '').trim()));
    if (marker) {
      for (let node = marker.parentElement; node && node !== document.body; node = node.parentElement) {
        const ids = idsWithin(node);
        if ([...ids].some(id => id !== adId)) break;
        const creative = [...node.querySelectorAll('video, img')].some(el => {
          const r = el.getBoundingClientRect();
          return r.width >= 150 && r.height >= 100 && !/profile|avatar|logo/i.test(el.getAttribute('alt') || '');
        });
        if (creative) { root = node; break; }
      }
    }
  }
  // Dedicated snapshot documents can be scoped by their URL, but search pages cannot.
  if (!root && /\/ads\/archive\/render_ad/.test(location.pathname)
      && new URL(location.href).searchParams.get('id') === adId
      && ![...idsWithin(document)].some(id => id !== adId)
      && !document.querySelector('input[type="password"]')) root = document.body;

  const json = [...document.querySelectorAll('script[type="application/json"]')]
    .map(s => s.textContent).filter(s => s && s.length < 2000000).slice(0, 40);
  if (!root) return { items: [], json, scoped: false };
  const visible = el => {
    const owner = el.closest('[data-ad-id], [data-ad-archive-id]');
    if (owner && (owner.getAttribute('data-ad-id') || owner.getAttribute('data-ad-archive-id')) !== adId) return false;
    const r = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return r.width >= 120 && r.height >= 100 && css.display !== 'none' && css.visibility !== 'hidden';
  };
  const items = [];
  for (const video of root.querySelectorAll('video')) {
    if (!visible(video)) continue;
    items.push({ mediaType: 'video', videoUrl: video.currentSrc || video.src,
      videoSources: [...video.querySelectorAll('source')].map(s => s.src),
      thumbnailUrl: video.poster, width: video.videoWidth, height: video.videoHeight });
    video.muted = true;
    video.play().catch(() => {});
  }
  for (const img of root.querySelectorAll('img')) {
    if (!visible(img) || !img.complete || img.naturalWidth < 150 || img.naturalHeight < 100
        || /profile|avatar|logo/i.test(img.alt || '') || img.classList.contains('_8nqq')) continue;
    const src = img.currentSrc || img.src;
    if (items.some(v => v.thumbnailUrl === src)) continue;
    items.push({ mediaType: 'image', thumbnailUrl: src, width: img.naturalWidth, height: img.naturalHeight });
  }
  for (const el of root.querySelectorAll('[style*="background-image"]')) {
    if (!visible(el)) continue;
    const match = getComputedStyle(el).backgroundImage.match(/^url\(["']?(https?:\/\/.*?)["']?\)$/);
    if (match) items.push({ mediaType: 'image', thumbnailUrl: match[1] });
  }
  const links = [...root.querySelectorAll('a[href]')].map(a => a.href);
  const cta = [...root.querySelectorAll('a, button, [role="button"]')]
    .map(b => (b.innerText || '').trim())
    .find(s => /^(shop now|learn more|order now|get offer|sign up|download|book now|apply now|contact us|subscribe|buy now|visit website)$/i.test(s));
  return { items, links, cta, json, scoped: true };
}

module.exports = { MEDIA_SCHEMA_VERSION, MEDIA_CACHE_TTL_MS, httpUrl, mediaUrl,
  isAvatarUrl, isUrlExpired, destinationUrl, normalizeCreative, mediaResult,
  extractStructuredMedia, inspectAdDocument };
