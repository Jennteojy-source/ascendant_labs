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

const { getCachedMediaBatch, saveMediaBatch, isUrlExpired, isAvatarUrl } = require('./firestore_cache');

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

function loadCache() {
  const { memoryCache } = require('./firestore_cache');
  const obj = {};
  for (const [k, v] of memoryCache.entries()) {
    obj[k] = v;
  }
  return obj;
}

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
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
      ],
    });
  }
  return sharedBrowser;
}

/**
 * Sniff media for a single ad snapshot URL with anti-bot stealth & fast exit
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
    viewport: { width: 900, height: 1200 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    },
  });

  // Stealth: Mask navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  const networkVideos = [];
  const networkImages = [];

  // 1. Abort non-essential network bloat (fonts, analytics, tracking pixels)
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
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 7500 });

    // Try to trigger video play if a video element is present
    await page.evaluate(() => {
      const vids = document.querySelectorAll('video');
      vids.forEach((v) => {
        v.muted = true;
        v.play().catch(() => {});
      });
    }).catch(() => {});

    // Fast-exit polling: Check every 100ms, cap at 2200ms
    const start = Date.now();
    while (Date.now() - start < 2200) {
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

      // Fast exit as soon as creative media arrives
      if (
        domData.domVideos.length > 0 ||
        domData.domImages.length > 0 ||
        networkVideos.length > 0 ||
        networkImages.length > 0
      ) {
        break;
      }
      await page.waitForTimeout(100);
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
 * Sniff media for a batch of ads with Firestore cache & paced concurrency
 */
async function sniffPageMedia(adsBatch = []) {
  const results = {};
  if (!adsBatch || adsBatch.length === 0) return results;

  const adIds = adsBatch.map((a) => String(a.id));

  // 1. Check persistent Firestore + in-memory cache first (0ms)
  const cachedMediaMap = await getCachedMediaBatch(adIds);
  const adsToSniff = [];

  for (const ad of adsBatch) {
    const idStr = String(ad.id);
    if (cachedMediaMap[idStr] && cachedMediaMap[idStr].mediaType !== 'unknown') {
      results[idStr] = cachedMediaMap[idStr];
    } else {
      adsToSniff.push(ad);
    }
  }

  if (adsToSniff.length === 0) {
    return results;
  }

  // 2. Sniff uncached ads with low concurrency (2) & pacing to protect RAM & avoid IP limits
  const browser = await getBrowser();
  const concurrency = 2;
  const newlySniffed = {};

  for (let i = 0; i < adsToSniff.length; i += concurrency) {
    const chunk = adsToSniff.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (ad) => {
        const media = await sniffSingleAd(browser, ad.id, ad.adSnapshotUrl);
        results[ad.id] = media;
        if (media.mediaType !== 'unknown') {
          newlySniffed[ad.id] = media;
        }
      })
    );
    // Pacing jitter between chunks (200ms)
    if (i + concurrency < adsToSniff.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // 3. Persist newly sniffed ads to Firestore + in-memory cache
  if (Object.keys(newlySniffed).length > 0) {
    await saveMediaBatch(newlySniffed);
  }

  return results;
}

module.exports = {
  sniffPageMedia,
  loadCache,
};
