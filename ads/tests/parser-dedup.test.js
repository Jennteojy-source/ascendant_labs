const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAdsFromPayload } = require('../lib/meta_browser_searcher');
const { deduplicateAndRankAds } = require('../lib/ad_ranker');
const { storedAssetPaths } = require('../lib/search_logger');
const { buildRetrievalPlan, findComparables } = require('../lib/comparable_finder');
const { sanitizeAgentQueries } = require('../lib/ai_retrieval_agent');

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

test('retrieval plan keeps exact global identity first and adds bounded relaxation', () => {
  const plan = buildRetrievalPlan([
    { type: 'EXACT_BRAND', query: 'Lyza Education' },
    { type: 'PAGE_VARIATION', query: 'Lyza Education Official' },
    { type: 'AFFILIATE_ANGLE', query: 'Lyza Education review' },
  ], 6);
  assert.deepEqual(plan.map(item => item.type), [
    'EXACT_BRAND', 'PAGE_VARIATION', 'AFFILIATE_ANGLE', 'RELAXED_COMPACT', 'RELAXED_BRAND_TOKEN',
  ]);
  assert.equal(plan[0].query, 'Lyza Education');
  assert.equal(plan.at(-1).query, 'Lyza');
});

test('fallback terms run only when exact global retrieval is sparse', async () => {
  const calls = [];
  const results = await findComparables({
    vectors: [{ type: 'EXACT_BRAND', query: 'Example Brand' }, { type: 'PAGE_VARIATION', query: 'Example Brand Official' }],
    minRecall: 2,
    maxQueries: 3,
    queryArchive: async term => {
      calls.push(term);
      return { data: term === 'Example Brand' ? [{ id: '123456789', page_name: 'Example Brand' }] : [
        { id: '223456789', page_name: 'Example Brand' }, { id: '323456789', page_name: 'Example Brand' },
      ], error: null, blocked: false };
    },
  });
  assert.deepEqual(calls, ['Example Brand', 'Example Brand Official']);
  assert.equal(results.totalRawAds, 3);
});

test('AI follow-up queries retain brand identity and replace static fallback when available', async () => {
  assert.deepEqual(sanitizeAgentQueries([
    { type: 'PAGE_VARIATION', query: 'Lyza Coding' },
    { type: 'PRODUCT_NAME', query: 'Unrelated Brand' },
  ], 'Lyza Education', 2), [{ type: 'PAGE_VARIATION', query: 'Lyza Coding' }]);

  const calls = [];
  await findComparables({
    vectors: [{ type: 'EXACT_BRAND', query: 'Example Brand' }, { type: 'PAGE_VARIATION', query: 'Example Brand Official' }],
    minRecall: 1,
    maxQueries: 2,
    nextQueries: async () => [{ type: 'AI_FOLLOWUP', query: 'Example Brand campaign' }],
    queryArchive: async term => {
      calls.push(term);
      return { data: term === 'Example Brand campaign' ? [{ id: '423456789', page_name: 'Example Brand' }] : [], error: null, blocked: false };
    },
  });
  assert.deepEqual(calls, ['Example Brand', 'Example Brand campaign']);
});
