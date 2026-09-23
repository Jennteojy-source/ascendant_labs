const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStructuredMedia, isAvatarUrl, destinationUrl, mediaResult } = require('../lib/media_resolver');
const { normalizeCacheEntry } = require('../lib/firestore_cache');
const { snapshotTarget, createMediaSniffer } = require('../lib/paginated_sniffer');
const { fetchAllowedMedia, objectName, persistMedia, publicMediaUrl } = require('../lib/media_storage');
const image = 'https://scontent.xx.fbcdn.net/v/t51.2885-15/creative.jpg';
const video = 'https://video.xx.fbcdn.net/creative.mp4';

test('extracts only the requested ad and keeps carousel cards and their own posters', () => {
  const result = extractStructuredMedia({ edges: [
    { node: { ad_archive_id: '999', snapshot: { images: [{ original_image_url: 'https://scontent.xx.fbcdn.net/wrong.jpg' }] } } },
    { node: { ad_archive_id: '123', snapshot: { page_profile_picture_url: 'https://scontent.xx.fbcdn.net/avatar.jpg', cards: [
      { original_image_url: image, link_url: 'https://shop.example/first' },
      { video_sd_url: video, video_hd_url: 'https://video.xx.fbcdn.net/hd.mp4', video_preview_image_url: 'https://scontent.xx.fbcdn.net/poster.jpg' },
    ] } } },
  ] }, '123');
  assert.equal(result.creatives.length, 2);
  assert.equal(result.creatives[0].thumbnailUrl, image);
  assert.equal(result.creatives[1].videoUrl, video);
  assert.equal(result.creatives[1].videoSources.length, 2);
  assert.equal(result.creatives[1].thumbnailUrl, 'https://scontent.xx.fbcdn.net/poster.jpg');
  assert.equal(extractStructuredMedia({ ad_archive_id: '999', snapshot: { images: [{ original_image_url: image }] } }, '123').status, 'unavailable');
});

test('does not classify every t51 creative as an avatar or allow lookalike CDN hosts', () => {
  assert.equal(isAvatarUrl(image), false);
  assert.equal(isAvatarUrl('https://scontent.xx.fbcdn.net/a.jpg?stp=dst-jpg_s60x60'), true);
  assert.equal(mediaResult([{ thumbnailUrl: 'https://fbcdn.net.evil.example/a.jpg' }]).status, 'unavailable');
});

test('destination redirect is decoded exactly once', () => {
  const destination = 'https://shop.example/?offer=a%2Fb&key=c%26d';
  assert.equal(destinationUrl(`https://l.facebook.com/l.php?u=${encodeURIComponent(destination)}`), destination);
});

test('old/unbounded cache entries are invalidated while valid poster survives expired video', () => {
  const now = Date.now();
  assert.equal(normalizeCacheEntry({ thumbnailUrl: image, cachedAt: now }), null);
  const result = mediaResult([{ thumbnailUrl: image, videoUrl: `${video}?oe=1` }], 'structured');
  assert.equal(normalizeCacheEntry({ ...result, cachedAt: now - 7200000 }, now), null);
  const entry = normalizeCacheEntry({ ...result, cachedAt: now }, now);
  assert.equal(entry.thumbnailUrl, image);
  assert.equal(entry.videoUrl, null);
  assert.equal(entry.mediaType, 'video');
});

test('snapshot navigation is constrained to the requested ad on Meta', () => {
  assert.equal(snapshotTarget('123', 'https://www.facebook.com/ads/library/?id=999'), null);
  assert.equal(snapshotTarget('123', 'https://www.facebook.com.evil.example/ads/library/?id=123'), null);
  assert.equal(snapshotTarget('123', 'http://127.0.0.1/ads/library/?id=123'), null);
  assert.equal(snapshotTarget('123', 'https://www.facebook.com/ads/library/?id=123'), 'https://www.facebook.com/ads/library/?id=123');
});

test('simultaneous requests share an ad extraction and the process-wide concurrency budget', async () => {
  let active = 0; let peak = 0;
  const calls = [];
  const sniff = createMediaSniffer({ concurrency: 2, getCachedMediaBatch: async () => ({}),
    saveMediaBatch: async () => {}, getBrowser: async () => ({}),
    sniffSingleAd: async (_, id) => {
      calls.push(id); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10)); active--;
      return mediaResult([{ thumbnailUrl: image }], 'structured');
    } });
  const [a, b] = await Promise.all([sniff([{ id: '1' }, { id: '2' }]), sniff([{ id: '1' }, { id: '3' }])]);
  assert.deepEqual(calls.sort(), ['1', '2', '3']);
  assert.equal(peak, 2);
  assert.deepEqual(a['1'], b['1']);
  await sniff([{ id: '1' }], { forceRefresh: true });
  await sniff([{ id: '1' }], { forceRefresh: true });
  assert.equal(calls.filter(id => id === '1').length, 2, 'one immediate forced refresh, then cooldown');
});

test('durable media paths are content-addressed and cannot escape the ad prefix', () => {
  const hash = 'a'.repeat(64);
  assert.equal(objectName('123', hash, 'mp4'), `ad-media/123/${hash}.mp4`);
  assert.equal(publicMediaUrl(`ad-media/123/${hash}.mp4`), `/api/media/123/${hash}.mp4`);
  assert.equal(objectName('../123', hash, 'mp4'), null);
  assert.equal(objectName('123', hash, 'html'), null);
});

test('media ingestion validates bytes and replaces expiring CDN URLs with stable app URLs', async () => {
  const saved = [];
  const bucket = { file: name => ({
    exists: async () => [false],
    save: async (buffer, options) => saved.push({ name, buffer, options }),
  }) };
  const fetch = async () => new Response(Buffer.from('jpeg test data'), {
    status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '14' },
  });
  const downloaded = await fetchAllowedMedia(image, 'image', { fetch });
  assert.equal(downloaded.contentType, 'image/jpeg');
  const durable = await persistMedia('123', mediaResult([{ thumbnailUrl: image }], 'structured'), { bucket, fetch });
  assert.equal(durable.storageStatus, 'ready');
  assert.match(durable.thumbnailUrl, /^\/api\/media\/123\/[a-f0-9]{64}\.jpg$/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].options.metadata.cacheControl, 'public, max-age=31536000, immutable');
});

test('deduplicates multiple resized resolutions of the same image asset', () => {
  const c1 = {
    thumbnailUrl: 'https://scontent-iad3-1.xx.fbcdn.net/v/t39.35426-6/48591234_1234567890_n.jpg?stp=dst-jpg_s600x600',
    width: 600, height: 600,
  };
  const c2 = {
    thumbnailUrl: 'https://scontent-iad3-1.xx.fbcdn.net/v/t39.35426-6/48591234_1234567890_n.jpg?stp=dst-jpg_s960x960',
    width: 960, height: 960,
  };
  const c3 = {
    thumbnailUrl: 'https://scontent-iad3-1.xx.fbcdn.net/v/t39.35426-6/48591234_1234567890_n.jpg?stp=dst-jpg_s1200x1200',
    width: 1200, height: 1200,
  };
  const c4 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/48591234_1234567890_n.jpg',
    width: 300, height: 300,
  };
  const diffImage = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/99998888_1234567890_n.jpg',
    width: 800, height: 800,
  };
  const result = mediaResult([c1, c2, c3, c4, diffImage], 'structured');
  // 4 identical bottle images + 1 different image = 2 unique creatives
  assert.equal(result.creatives.length, 2);
  // Kept the highest resolution for the first image
  assert.equal(result.creatives[0].width, 1200);
  assert.equal(result.creatives[0].thumbnailUrl, c3.thumbnailUrl);
  assert.equal(result.creatives[1].thumbnailUrl, diffImage.thumbnailUrl);
});

test('deduplicates DCO placement crops of the same image creative into a single creative', () => {
  // Simulates Meta DCO (Dynamic Creative Optimization) where 4 placement crops of the same image
  // are generated with different CDN photo IDs, identical destination URL (with utm_content=image_01),
  // identical headline, and identical body text (e.g. FemiCore ad).
  const crop1 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/814509154_1063217983358526_n.jpg?stp=dst-jpg_s600x600',
    destinationUrl: 'https://womenscareinsights.com/?utm_source=meta&utm_medium=paid&utm_campaign=femicore_meta_01&utm_content=image_01',
    ctaText: 'See Details',
    title: 'FemiCore: Ingredients & Research Guide',
    body: 'Looking for real information before trying a supplement? We broke down the ingredients, research, and reviews behind FemiCore.',
    displayFormat: 'DCO',
    width: 600, height: 600,
  };
  const crop2 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/813583495_1788153722310123_n.jpg?stp=dst-jpg_s600x600',
    destinationUrl: 'https://womenscareinsights.com/?utm_source=meta&utm_medium=paid&utm_campaign=femicore_meta_01&utm_content=image_01',
    ctaText: 'See Details',
    title: 'FemiCore: Ingredients & Research Guide',
    body: 'Looking for real information before trying a supplement? We broke down the ingredients, research, and reviews behind FemiCore.',
    displayFormat: 'DCO',
    width: 1080, height: 1920,
  };
  const crop3 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/811904400_1751955042560280_n.jpg?stp=dst-jpg_s600x600',
    destinationUrl: 'https://womenscareinsights.com/?utm_source=meta&utm_medium=paid&utm_campaign=femicore_meta_01&utm_content=image_01',
    ctaText: 'See Details',
    title: 'FemiCore: Ingredients & Research Guide',
    body: 'Looking for real information before trying a supplement? We broke down the ingredients, research, and reviews behind FemiCore.',
    displayFormat: 'DCO',
    width: 1080, height: 1350,
  };
  const crop4 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/813715739_1058808550256544_n.jpg?stp=dst-jpg_s600x600',
    destinationUrl: 'https://womenscareinsights.com/?utm_source=meta&utm_medium=paid&utm_campaign=femicore_meta_01&utm_content=image_01',
    ctaText: 'See Details',
    title: 'FemiCore: Ingredients & Research Guide',
    body: 'Looking for real information before trying a supplement? We broke down the ingredients, research, and reviews behind FemiCore.',
    displayFormat: 'DCO',
    width: 1200, height: 628,
  };

  const result = mediaResult([crop1, crop2, crop3, crop4], 'structured', 'unavailable', { displayFormat: 'DCO' });
  // All 4 placement crops collapsed to 1 single creative
  assert.equal(result.creatives.length, 1);
  assert.equal(result.creatives[0].title, 'FemiCore: Ingredients & Research Guide');
  // Kept highest area crop (1080x1920)
  assert.equal(result.creatives[0].thumbnailUrl, crop2.thumbnailUrl);
  // Preserved fallback image sources
  assert.equal(result.creatives[0].imageSources.length, 4);
});

test('preserves genuine multi-card carousel ads with distinct card titles', () => {
  const card1 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/753356757_1003311539143079_n.jpg',
    destinationUrl: 'https://clny.co/cadburyafrica',
    ctaText: 'See Details',
    title: 'Cadbury Dairy Milk',
    displayFormat: 'CAROUSEL',
  };
  const card2 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/752838643_1709997353551499_n.jpg',
    destinationUrl: 'https://clny.co/cadburyafrica',
    ctaText: 'See Details',
    title: 'Cadbury Top Deck',
    displayFormat: 'CAROUSEL',
  };
  const card3 = {
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t39.35426-6/751611383_1023480323982502_n.jpg',
    destinationUrl: 'https://clny.co/cadburyafrica',
    ctaText: 'See Details',
    title: 'Cadbury Wholenut',
    displayFormat: 'CAROUSEL',
  };

  const result = mediaResult([card1, card2, card3], 'structured', 'unavailable', { displayFormat: 'CAROUSEL' });
  // Distinct carousel cards are preserved
  assert.equal(result.creatives.length, 3);
  assert.equal(result.creatives[0].title, 'Cadbury Dairy Milk');
  assert.equal(result.creatives[1].title, 'Cadbury Top Deck');
  assert.equal(result.creatives[2].title, 'Cadbury Wholenut');
});

