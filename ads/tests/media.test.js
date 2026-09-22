const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStructuredMedia, isAvatarUrl, destinationUrl, mediaResult } = require('../lib/media_resolver');
const { normalizeCacheEntry } = require('../lib/firestore_cache');
const { snapshotTarget, createMediaSniffer } = require('../lib/paginated_sniffer');
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
