const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAdsFromPayload } = require('../lib/meta_browser_searcher');
const { deduplicateAndRankAds } = require('../lib/ad_ranker');
const { storedAssetPaths } = require('../lib/search_logger');

test('nested Meta fields retain their primary text, headline, and description roles', () => {
  const payload = { data: { ads: [{
    ad_archive_id: '123456789', page_name: 'Example Brand',
    snapshot: {
      body: [{ text_content: 'Primary text from the creative.' }],
      headline: { text: 'A distinct headline' },
      link_description: { text: 'A distinct description' },
    },
  }] } };
  const [ad] = extractAdsFromPayload(payload);
  assert.deepEqual(ad.ad_creative_bodies, ['Primary text from the creative.']);
  assert.deepEqual(ad.ad_creative_link_titles, ['A distinct headline']);
  assert.deepEqual(ad.ad_creative_link_descriptions, ['A distinct description']);
});

test('identical creative copy is deduplicated even when Ads Library returns another page entry', () => {
  const raw = [{
    id: '100000001', page_name: 'Example Brand', ad_delivery_start_time: '2026-01-01T00:00:00.000Z',
    ad_creative_bodies: ['Same primary text'], ad_creative_link_titles: ['Same headline'],
    ad_creative_link_descriptions: ['Same description'], ad_creative_link_captions: ['example.com'],
    publisher_platforms: ['facebook'],
  }, {
    id: '100000002', page_name: 'Another entry', ad_delivery_start_time: '2026-01-02T00:00:00.000Z',
    ad_creative_bodies: ['Same primary text'], ad_creative_link_titles: ['Same headline'],
    ad_creative_link_descriptions: ['Same description'], ad_creative_link_captions: ['example.com'],
    publisher_platforms: ['facebook'],
  }];
  const results = deduplicateAndRankAds(raw, { targetBrand: 'example brand' });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].associatedAdIds, ['100000001', '100000002']);
});

test('canonical ad records expose the backing GCS object path', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(storedAssetPaths({ thumbnailUrl: `/api/media/123/${hash}.jpg` }, '123'), [`ad-media/123/${hash}.jpg`]);
});
