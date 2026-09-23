const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { inspectAdDocument, mediaResult } = require('../lib/media_resolver');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const image = 'https://scontent.xx.fbcdn.net/portrait.jpg?sig=a%22b&other=1';
const alternate = 'https://scontent.xx.fbcdn.net/second.jpg';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#a5b4fc"/><text x="35" y="300" font-size="32">Ad creative</text></svg>';
const ad = (id, media) => ({ id, pageName: 'Example advertiser', media,
  copy: { body: 'A relevant product advertisement.', headline: 'Example creative' },
  stats: { flightDays: 10, isActive: true, countries: ['US'], platforms: ['facebook'] }, ranking: {} });

async function appPage(t, ads, sniff = async () => ({})) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const u = new URL(request.url());
    if (u.hostname.endsWith('fbcdn.net')) {
      if (u.pathname.endsWith('.mp4') || u.pathname.includes('broken')) return route.fulfill({ status: 403, body: 'Unavailable' });
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    if (u.hostname !== '127.0.0.1') return route.abort();
    if (u.pathname === '/api/search') return route.fulfill({ json: { queryProfile: {}, paginated: { items: ads } } });
    if (u.pathname === '/api/sniff-page') return route.fulfill({ json: { mediaMap: await sniff(request.postDataJSON()) } });
    if (u.pathname === '/api/health') return route.fulfill({ json: { status: 'OK' } });
    const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    if (!['index.html', 'app.js', 'media.js', 'styles.css'].includes(name)) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
      body: fs.readFileSync(path.resolve(__dirname, '../../public', name), 'utf8') });
  });
  await page.goto('http://127.0.0.1/');
  await page.evaluate(() => { executeSearch('Example product'); });
  await page.waitForFunction(() => state.rawRankedAds.length > 0);
  t.after(() => assert.deepEqual(errors, [], 'no browser JavaScript errors'));
  return page;
}

test('DOM fallback stays inside the requested ad and retains valid t51 images', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.route('**/*', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.setContent(`<div data-ad-id="999"><img width="400" height="600" src="https://scontent.xx.fbcdn.net/wrong.jpg"></div>
    <div data-ad-id="123"><img width="400" height="600" src="https://scontent.xx.fbcdn.net/v/t51.2885-15/right.jpg"></div>`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  const result = await page.evaluate(inspectAdDocument, '123');
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].thumbnailUrl, /right\.jpg/);
  assert.equal((await page.evaluate(inspectAdDocument, '456')).items.length, 0);
});

test('public Library ID labels scope creatives without relying on private CSS classes', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.route('**/*', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.setContent(`<section><span>Library ID: 999</span><img width="400" height="600" src="https://scontent.xx.fbcdn.net/wrong.jpg"></section>
    <section><span>Library ID: 123</span><img width="400" height="600" src="${alternate}"></section>`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  const result = await page.evaluate(inspectAdDocument, '123');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].thumbnailUrl, alternate);
});

test('snapshot URL alone cannot associate another ad shown in the document', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: `<section><span>Library ID: 999</span><img width="400" height="600" src="${alternate}"></section>` })
    : route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.goto('https://www.facebook.com/ads/archive/render_ad/?id=123');
  assert.equal((await page.evaluate(inspectAdDocument, '123')).items.length, 0);
});

test('grid preserves separate ads sharing an image and renders navigable creatives safely', async t => {
  const media = mediaResult([{ thumbnailUrl: image }, { thumbnailUrl: alternate }], 'structured');
  const page = await appPage(t, [ad('123', media), ad('456', media)]);
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.naturalWidth === 400);
  assert.equal(await page.locator('.ad-card').count(), 2);
  assert.equal(await page.locator('#media-box-123 img').getAttribute('src'), image);
  assert.equal(await page.locator('#media-box-123 img').evaluate(el => getComputedStyle(el).objectFit), 'contain');
  await page.locator('#media-box-123').getByRole('button', { name: 'Next creative' }).click();
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.src.includes('second.jpg'));
  assert.match(await page.locator('#media-box-123').innerText(), /Creative 2 of 2/);
});

test('expired image triggers one refresh and swaps in fresh media', async t => {
  let refreshes = 0;
  const page = await appPage(t, [ad('123', mediaResult([{ thumbnailUrl: 'https://scontent.xx.fbcdn.net/broken.jpg' }], 'structured'))], async body => {
    assert.equal(body.forceRefresh, true); refreshes++;
    return { '123': mediaResult([{ thumbnailUrl: image }], 'structured') };
  });
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.naturalWidth === 400);
  assert.equal(refreshes, 1);
  assert.equal(await page.locator('#media-box-123 img').getAttribute('src'), image);
});

test('video failure retains poster, bounds automatic refresh, and allows explicit retry', async t => {
  let refreshes = 0;
  const media = mediaResult([{ videoUrl: 'https://video.xx.fbcdn.net/broken.mp4', thumbnailUrl: image }], 'structured');
  const page = await appPage(t, [ad('123', media)], async () => { refreshes++; return { '123': media }; });
  await page.getByRole('button', { name: 'Retry preview' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.naturalWidth === 400);
  assert.equal(refreshes, 1);
  assert.equal(await page.locator('#media-box-123 video').count(), 0);
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await page.waitForFunction(() => document.querySelector('#media-box-123 .media-status')?.textContent.includes('You can retry'));
  assert.equal(refreshes, 2);
});

test('failed extraction can be retried without a permanent loading placeholder', async t => {
  let attempts = 0;
  const page = await appPage(t, [ad('123', null)], async () => ({
    '123': ++attempts === 1 ? mediaResult([], null, 'blocked') : mediaResult([{ thumbnailUrl: image }], 'structured'),
  }));
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.naturalWidth === 400);
  assert.equal(attempts, 2);
});

test('modal creative controls remain visible on a phone-sized viewport', async t => {
  const media = mediaResult([{ thumbnailUrl: image }, { thumbnailUrl: alternate }], 'structured');
  const page = await appPage(t, [ad('123', media)]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.openVariantsModal('123'));
  await page.locator('#modalMediaBox').getByRole('button', { name: 'Next creative' }).click();
  await page.waitForFunction(() => document.querySelector('#modalMediaBox img')?.naturalWidth === 400);
  const dimensions = await page.locator('#modalMediaBox').evaluate(el => {
    const outer = el.getBoundingClientRect();
    const nav = el.querySelector('.media-navigation').getBoundingClientRect();
    return { outerBottom: outer.bottom, navBottom: nav.bottom };
  });
  assert.ok(dimensions.navBottom <= dimensions.outerBottom + 1, 'carousel is not clipped');
  assert.equal(await page.locator('#modalMediaBox img').getAttribute('src'), alternate);
});

test('late extraction from an earlier search cannot overwrite the new search', async t => {
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let calls = 0; const requestModes = [];
  const page = await appPage(t, [ad('123', null)], async body => {
    requestModes.push(Boolean(body.forceRefresh));
    if (++calls === 1) { started(); await held; return { '123': mediaResult([{ thumbnailUrl: image }], 'structured') }; }
    return { '123': mediaResult([{ thumbnailUrl: alternate }], 'structured') };
  });
  await began;
  await page.evaluate(() => executeSearch('A different search'));
  release();
  await page.waitForFunction(() => document.querySelector('#media-box-123 img')?.src.includes('second.jpg'));
  assert.equal(calls, 2, `request modes: ${requestModes.join(',')}`);
  assert.equal(await page.evaluate(() => state.resolvedMediaMap['123'].thumbnailUrl), alternate);
});

test('opening the modal before extraction finishes still displays the completed preview', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const page = await appPage(t, [ad('123', null)], async () => {
    await held; return { '123': mediaResult([{ thumbnailUrl: image }], 'structured') };
  });
  await page.evaluate(() => window.openVariantsModal('123'));
  release();
  await page.waitForFunction(() => document.querySelector('#modalMediaBox img')?.naturalWidth === 400);
  assert.equal(await page.locator('#modalMediaBox img').getAttribute('src'), image);
});
