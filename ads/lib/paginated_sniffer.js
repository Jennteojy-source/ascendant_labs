/**
 * Paginated Lightweight Media Sniffer (V3 Precision High-Res & Video Extraction)
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Features:
 * - Direct DOM evaluation: extracts exact high-res creative images (>150px) and video posters.
 * - Zero Avatar Fallback: strictly filters out 60x60 advertiser profile pictures and avatars.
 * - Intercepts MP4 video streams and auto-triggers playback in headless Chromium.
 * - Persistent disk & in-memory cache for instant 0ms subsequent loads.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'media_cache.json');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

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

const USER_TOKEN =
  process.env.USER_TOKEN || process.env.META_ACCESS_TOKEN || process.env.CAPI_ACCESS_TOKEN;

function isAvatarUrl(url) {
  if (!url) return false;
  return /s60x60|s150x150|s206x206|p50x50|p100x100|profile_pic|t51\.82787|_8nqq/i.test(url);
}

/**
 * Check if a Meta signed CDN URL has expired (oe= parameter is a hex timestamp)
 */
function isUrlExpired(url) {
  if (!url) return false;
  const match = url.match(/[?&]oe=([0-9a-fA-F]+)/);
  if (match) {
    const expirySec = parseInt(match[1], 16);
    if (!isNaN(expirySec) && (Date.now() / 1000) > (expirySec - 3600)) {
      return true; // Expired or expiring within 1 hour
    }
  }
  return false;
}

function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      let modified = false;
      for (const [id, entry] of Object.entries(data)) {
        const isBad = (entry.thumbnailUrl && isAvatarUrl(entry.thumbnailUrl)) ||
                      isUrlExpired(entry.thumbnailUrl) ||
                      isUrlExpired(entry.videoUrl);
        if (isBad) {
          delete data[id];
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
      }
      return data;
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}
}

const memoryCache = loadCache();
let sharedBrowser = null;

async function getBrowser() {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
  }
  return sharedBrowser;
}

/**
 * Sniff media for a single ad snapshot URL
 */
async function sniffSingleAd(browser, adId, snapshotUrl) {
  let targetUrl = snapshotUrl;
  if (!targetUrl && adId && USER_TOKEN) {
    targetUrl = `https://www.facebook.com/ads/archive/render_ad/?id=${adId}&access_token=${USER_TOKEN}`;
  }

  if (!targetUrl) {
    return { thumbnailUrl: null, videoUrl: null, mediaType: 'unknown' };
  }

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 900, height: 1400 },
  });
  const page = await context.newPage();

  const networkVideos = [];
  const networkImages = [];

  // 1. Abort non-essential network bloat (fonts, third-party trackers)
  await page.route('**/*', (route) => {
    const rType = route.request().resourceType();
    const url = route.request().url();
    if (
      rType === 'font' ||
      url.includes('google-analytics') ||
      url.includes('hsts-pixel')
    ) {
      return route.abort();
    }
    return route.continue();
  });

  // 2. Intercept CDN packets
  page.on('response', (res) => {
    const url = res.url();
    const ct = (res.headers()['content-type'] || '').toLowerCase();

    // Catch MP4 video stream
    if (ct.startsWith('video/') || url.includes('.mp4')) {
      if (!networkVideos.includes(url)) {
        networkVideos.push(url);
      }
    }
    // Catch high-res creative images
    else if (
      ct.startsWith('image/') &&
      (url.includes('scontent') || url.includes('fbcdn.net')) &&
      !url.includes('hsts-pixel') &&
      !url.includes('rsrc.php')
    ) {
      if (!isAvatarUrl(url) && !networkImages.includes(url)) {
        networkImages.push(url);
      }
    }
  });

  let domData = { domVideos: [], domImages: [] };

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 9000 });

    // Try to trigger video play if a video element is in the DOM
    await page.evaluate(() => {
      const vids = document.querySelectorAll('video');
      vids.forEach((v) => {
        v.muted = true;
        v.play().catch(() => {});
      });
    }).catch(() => {});

    // Poll until creative arrives (DOM elements or network responses)
    const start = Date.now();
    while (Date.now() - start < 5000) {
      domData = await page.evaluate(() => {
        const vids = Array.from(document.querySelectorAll('video'))
          .map((v) => ({
            src: v.src || (v.querySelector('source') ? v.querySelector('source').src : ''),
            poster: v.getAttribute('poster') || '',
          }))
          .filter((v) => (v.src && v.src.startsWith('http')) || (v.poster && v.poster.startsWith('http')));

        const imgs = Array.from(document.querySelectorAll('img'))
          .filter((i) => {
            const w = i.naturalWidth || i.width || 0;
            const h = i.naturalHeight || i.height || 0;
            const src = i.src || '';
            const isAvatar =
              /s60x60|s150x150|s206x206|p50x50|p100x100|profile_pic|t51\./i.test(src) ||
              i.classList.contains('_8nqq');
            return w >= 150 && h >= 150 && !isAvatar && !src.includes('rsrc.php') && !src.includes('hsts-pixel');
          })
          .map((i) => i.src);

        return { domVideos: vids, domImages: imgs };
      }).catch(() => ({ domVideos: [], domImages: [] }));

      if (
        domData.domVideos.length > 0 ||
        domData.domImages.length > 0 ||
        networkVideos.length > 0 ||
        networkImages.length > 0
      ) {
        break;
      }
      await page.waitForTimeout(200);
    }
  } catch (err) {
    // Graceful timeout
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  // Resolve best video and thumbnail
  let videoUrl = null;
  let thumbnailUrl = null;

  // 1. Check DOM video
  if (domData.domVideos && domData.domVideos.length > 0) {
    const v = domData.domVideos[0];
    if (v.src && v.src.startsWith('http')) videoUrl = v.src;
    if (v.poster && v.poster.startsWith('http') && !isAvatarUrl(v.poster)) thumbnailUrl = v.poster;
  }

  // 2. Fallback to network video
  if (!videoUrl && networkVideos.length > 0) {
    videoUrl = networkVideos[0];
  }

  // 3. Thumbnail resolution (never fall back to avatar)
  if (!thumbnailUrl) {
    if (domData.domImages && domData.domImages.length > 0) {
      thumbnailUrl = domData.domImages[0];
    } else if (networkImages.length > 0) {
      thumbnailUrl = networkImages[0];
    }
  }

  const mediaType = videoUrl ? 'video' : thumbnailUrl ? 'image' : 'unknown';

  return {
    thumbnailUrl,
    videoUrl,
    mediaType,
  };
}

/**
 * Sniff media for a batch of up to 10 ads (the active page)
 */
async function sniffPageMedia(adsBatch = []) {
  const results = {};
  const adsToSniff = [];

  // Check cache first (ignore old cache if it was marked unknown, has avatar URL, or has expired)
  for (const ad of adsBatch) {
    const cached = memoryCache[ad.id];
    const isBadCache = cached && (
      (cached.thumbnailUrl && isAvatarUrl(cached.thumbnailUrl)) ||
      isUrlExpired(cached.thumbnailUrl) ||
      isUrlExpired(cached.videoUrl)
    );

    if (cached && cached.mediaType !== 'unknown' && !isBadCache) {
      results[ad.id] = cached;
    } else {
      adsToSniff.push(ad);
    }
  }

  if (adsToSniff.length === 0) {
    return results;
  }

  const browser = await getBrowser();
  const concurrency = 4;

  for (let i = 0; i < adsToSniff.length; i += concurrency) {
    const chunk = adsToSniff.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (ad) => {
        const media = await sniffSingleAd(browser, ad.id, ad.adSnapshotUrl);
        results[ad.id] = media;
        if (media.mediaType !== 'unknown') {
          memoryCache[ad.id] = { ...media, cachedAt: Date.now() };
        }
      })
    );
  }

  saveCache(memoryCache);
  return results;
}

module.exports = {
  sniffPageMedia,
  loadCache,
};
