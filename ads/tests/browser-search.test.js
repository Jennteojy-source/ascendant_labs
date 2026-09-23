const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { buildAdsLibrarySearchUrl, browserConnectionMode, browserlessEndpoint, managedPlaywrightEndpoint,
  extractAdsFromPayload, extractAdsFromDocument } = require('../lib/meta_browser_searcher');

test('Browserless configuration uses an encrypted managed Playwright endpoint', () => {
  const env = { BROWSERLESS_API: 'test token', BROWSERLESS_REGION: 'lon',
    BROWSERLESS_PROXY_COUNTRY: 'gb' };
  const endpoint = new URL(browserlessEndpoint(env));
  assert.equal(browserConnectionMode(env), 'managed-browserless');
  assert.equal(endpoint.protocol, 'wss:');
  assert.equal(endpoint.hostname, 'production-lon.browserless.io');
  assert.equal(endpoint.pathname, '/chromium/playwright');
  assert.equal(endpoint.searchParams.get('token'), 'test token');
  assert.equal(endpoint.searchParams.get('proxy'), 'residential');
  assert.equal(endpoint.searchParams.get('proxyCountry'), 'gb');
  assert.throws(() => managedPlaywrightEndpoint({ BROWSER_WS_ENDPOINT: 'http://localhost:9222' }),
    /encrypted wss/);
});

test('public Ads Library URLs contain browser filters and never credentials', () => {
  const url = new URL(buildAdsLibrarySearchUrl('memory pillow', {
    countries: ['GB', 'US'], status: 'ACTIVE', mediaType: 'VIDEO',
  }));
  assert.equal(url.origin, 'https://www.facebook.com');
  assert.equal(url.pathname, '/ads/library/');
  assert.equal(url.searchParams.get('q'), 'memory pillow');
  assert.equal(url.searchParams.get('country'), 'GB');
  assert.equal(url.searchParams.get('active_status'), 'active');
  assert.equal(url.searchParams.get('media_type'), 'video');
  assert.equal(url.searchParams.has('access_token'), false);
});

test('structured browser responses normalize into the ranking schema with media', () => {
  const payload = { data: { search: { edges: [{ node: {
    ad_archive_id: '123456789', page_id: '42', start_date: 1704067200,
    publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
    snapshot: {
      page_name: 'Example Brand', body: { text: 'A useful product for better sleep.' },
      title: 'Sleep better tonight', caption: 'example.com',
      videos: [{ video_sd_url: 'https://video.xx.fbcdn.net/ad.mp4',
        video_preview_image_url: 'https://scontent.xx.fbcdn.net/poster.jpg' }],
    },
  } }] } } };
  const [ad] = extractAdsFromPayload(payload);
  assert.equal(ad.id, '123456789');
  assert.equal(ad.page_name, 'Example Brand');
  assert.deepEqual(ad.ad_creative_bodies, ['A useful product for better sleep.']);
  assert.deepEqual(ad.ad_creative_link_titles, ['Sleep better tonight']);
  assert.deepEqual(ad.publisher_platforms, ['facebook', 'instagram']);
  assert.equal(ad.browserMedia.status, 'ready');
  assert.equal(ad.browserMedia.videoUrl, 'https://video.xx.fbcdn.net/ad.mp4');
});

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('visible Library cards provide a DOM fallback when response JSON changes', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/*', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"></svg>',
  }));
  await page.setContent(`<article>
    <a href="https://www.facebook.com/examplebrand">Example Brand</a>
    <div>Active</div><div>Started running on Jan 1, 2025</div><div>Library ID: 987654321</div>
    <p>Fix your sleep with this simple evening routine.</p><strong>Wake up refreshed</strong>
    <img src="https://scontent.xx.fbcdn.net/creative.jpg" width="600" height="600">
    <button>Learn More</button>
  </article>`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  const [ad] = await page.evaluate(extractAdsFromDocument);
  assert.equal(ad.id, '987654321');
  assert.equal(ad.pageName, 'Example Brand');
  assert.equal(ad.active, true);
  assert.equal(ad.ctaText, 'Learn More');
  assert.equal(ad.mediaItems.length, 1);
});

test('DOM fallback excludes navigation labels outside the nearest ad card', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(`<main><header><a>Log in</a><a>Meta Ad Library</a><a>Ad Library</a></header>
    <article><a href="https://www.facebook.com/examplebrand">Example Brand</a>
      <div>Active</div><div>Started running on Jan 1, 2025</div><div>Library ID: 987654322</div>
      <p>Real primary text for this specific creative.</p><strong>Real ad headline</strong>
      <img src="https://scontent.xx.fbcdn.net/creative.jpg" width="600" height="600">
    </article></main>`);
  const [ad] = await page.evaluate(extractAdsFromDocument);
  assert.equal(ad.pageName, 'Example Brand');
  assert.equal(ad.body, 'Real primary text for this specific creative.');
  assert.equal(ad.headline, 'Real ad headline');
});
