process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAdsFromPayload } = require('../lib/meta_browser_searcher');
const { deduplicateAndRankAds, isPresentableAd } = require('../lib/ad_ranker');
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

test('Library interface labels do not become primary text or headlines', () => {
  const [ad] = extractAdsFromPayload({ ads: [{
    ad_archive_id: '888000111', page_name: 'Example', snapshot: {
      body: 'Meta Ad Library', title: 'Ad Library',
      cards: [{ body: 'See summary details', link_title: 'Categories' }],
    },
  }] });
  assert.deepEqual(ad.ad_creative_bodies, []);
  assert.deepEqual(ad.ad_creative_link_titles, []);
});

test('Ads Library spend labels do not become ad copy', () => {
  const [ad] = extractAdsFromPayload({ ads: [{ ad_archive_id: '888000112',
    page_name: 'Example', snapshot: { body: 'Amount spent (USD):', title: 'Estimated audience size:' },
  }] });
  assert.deepEqual(ad.ad_creative_bodies, []);
  assert.deepEqual(ad.ad_creative_link_titles, []);
});

test('the same image served at different sizes and with revised copy is one creative group', () => {
  const imageBase = 'https://scontent.xx.fbcdn.net/v/t39.35426-6/48591234_1234567890_n.jpg';
  const ads = ['111000111', '222000222'].map((id, index) => ({
    id, page_name: 'Example', ad_creative_bodies: [`Copy variant ${index + 1}`],
    ad_creative_link_titles: ['A real headline'],
    browserMedia: { creatives: [{ thumbnailUrl: `${imageBase}?stp=dst-jpg_s${index ? '960' : '600'}x600` }] },
  }));
  const ranked = deduplicateAndRankAds(ads, { targetBrand: 'example' });
  assert.equal(ranked.length, 1);
  assert.deepEqual(ranked[0].associatedAdIds, ['111000111', '222000222']);
  assert.equal(ranked[0].variants.length, 2);
});

test('an ad that stopped within the last day is inactive', () => {
  const result = deduplicateAndRankAds([{
    id: '3030220743851482', page_name: 'Smart Discount Store',
    ad_delivery_start_time: new Date(Date.now() - 61 * 86400000).toISOString(),
    ad_delivery_stop_time: new Date(Date.now() - 3600000).toISOString(),
    ad_creative_bodies: ['Yu Sleep evening wellness routine'],
  }], { targetBrand: 'Yu Sleep' });
  assert.equal(result[0].stats.isActive, false);
});

test('an ad marked with is_active: true is active even if payload contains yesterday end_date', () => {
  const payload = { data: { ads: [{
    ad_archive_id: '999888777', page_name: 'ProDentim Official',
    is_active: true,
    start_date: Math.floor((Date.now() - 7 * 86400000) / 1000),
    end_date: Math.floor((Date.now() - 86400000) / 1000),
    snapshot: { body: 'ProDentim oral probiotic formula' }
  }] } };
  const [extracted] = extractAdsFromPayload(payload);
  assert.equal(extracted.is_active, true);
  assert.equal(extracted.ad_delivery_stop_time, null);

  const [ranked] = deduplicateAndRankAds([extracted], { targetBrand: 'ProDentim' });
  assert.equal(ranked.stats.isActive, true);
  assert.equal(ranked.stats.endDate, 'Present');
  assert.ok(ranked.ranking.rankScore >= 500, 'Active ad should receive active bonus');
});

test('a global search filter does not claim that an ad reached every country', () => {
  const [ad] = extractAdsFromPayload({ ads: [{ ad_archive_id: '888000333',
    page_name: 'Example', snapshot: { body: 'A real offer' } }] });
  const [ranked] = deduplicateAndRankAds([ad], { countries: ['ALL'], targetBrand: 'Example' });
  assert.deepEqual(ranked.stats.countries, []);
  assert.equal(ranked.stats.countryBasis, 'unknown');
});

test('per-ad reached and targeted countries remain distinct from search geography', () => {
  const [ad] = extractAdsFromPayload({ ads: [{ ad_archive_id: '888000334',
    page_name: 'Example', reached_countries: ['SG', 'US'],
    target_locations: [{ country_code: 'CA', included_or_excluded: 'Included' },
      { country_code: 'RU', included_or_excluded: 'Excluded' }],
    snapshot: { body: 'A real offer' } }] });
  const [ranked] = deduplicateAndRankAds([ad], { countries: ['ALL'], targetBrand: 'Example' });
  assert.deepEqual(ranked.stats.countries, ['SG', 'US']);
  assert.equal(ranked.stats.countryBasis, 'reached');
  assert.deepEqual(ranked.stats.reachedCountries, ['SG', 'US']);
  assert.deepEqual(ranked.stats.targetedCountries, ['CA']);
  assert.deepEqual(ranked.stats.excludedCountries, ['RU']);

  const [targeted] = deduplicateAndRankAds([{ ...ad, reached_countries: [] }],
    { countries: ['ALL'], targetBrand: 'Example' });
  assert.deepEqual(targeted.stats.countries, ['CA']);
  assert.equal(targeted.stats.countryBasis, 'targeted');
});

test('navigation captured as an ad is removed before ranking', () => {
  const ranked = deduplicateAndRankAds([{ id: '888000222', page_name: 'Log in',
    ad_creative_bodies: ['Meta Ad Library'], ad_creative_link_titles: ['Ad Library'] }]);
  assert.equal(ranked.length, 0);
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
    'EXACT_BRAND', 'PAGE_VARIATION', 'AFFILIATE_ANGLE', 'RELAXED_COMPACT',
  ]);
  assert.equal(plan[0].query, 'Lyza Education');
  assert.equal(plan.at(-1).query, 'LyzaEducation');
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

test('two sparse-query fallbacks share one browser wait without exceeding query budget', async () => {
  let active = 0;
  let peak = 0;
  const calls = [];
  await findComparables({
    vectors: [
      { type: 'EXACT_BRAND', query: 'Example Brand' },
      { type: 'PAGE_VARIATION', query: 'Example Brand Official' },
      { type: 'PRODUCT_NAME', query: 'Example Brand Product' },
    ],
    minRecall: 2, maxQueries: 3, nextQueries: async () => [],
    queryArchive: async term => {
      calls.push(term);
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { data: [], error: null, blocked: false };
    },
  });
  assert.equal(peak, 2);
  assert.deepEqual(calls, ['Example Brand', 'Example Brand Official', 'Example Brand Product']);
});

test('AI follow-up queries retain brand identity and replace static fallback when available', async () => {
  assert.deepEqual(sanitizeAgentQueries([
    { type: 'PAGE_VARIATION', query: 'Lyza Coding' },
    { type: 'PRODUCT_NAME', query: 'Unrelated Brand' },
  ], 'Lyza Education', 2, { aliases: ['Lyza Coding'] }),
  [{ type: 'PAGE_VARIATION', query: 'Lyza Coding' }]);

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

test('an in-flight exact browser result is reused after AI planning', async () => {
  const calls = [];
  const results = await findComparables({
    vectors: [{ type: 'EXACT_BRAND', query: 'Example Brand' }],
    minRecall: 1,
    initialSearches: [{ vector: { type: 'EXACT_BRAND', query: 'Example Brand' }, result: {
      data: [{ id: '523456789', page_name: 'Example Brand' }], error: null, blocked: false,
    } }],
    queryArchive: async term => { calls.push(term); return { data: [], error: null, blocked: false }; },
  });
  assert.equal(results.totalRawAds, 1);
  assert.deepEqual(calls, []);
});

test('unevaluated discovered noise is not presented as a search result', () => {
  assert.equal(isPresentableAd({ ranking: { relevanceType: 'DISCOVERED', relevanceScore: 45 } }), false);
  assert.equal(isPresentableAd({ ranking: { relevanceType: 'UNRELATED', relevanceScore: 5 } }), false);
  assert.equal(isPresentableAd({ ranking: { relevanceType: 'RELATED_OFFER', relevanceScore: 70 } }), true);
  assert.equal(isPresentableAd({ ranking: { relevanceType: 'OFFICIAL_BRAND', relevanceScore: 100 } }), true);
});

test('Meta group headers, EU transparency, flight date ranges, and unbound placeholders are filtered from copy', () => {
  const payload = { data: { ads: [{
    ad_archive_id: '999000111', page_name: 'FemiCore Brand',
    snapshot: {
      body: 'Jul 1, 2026 - Jul 29, 2026',
      title: '3 ads use this creative and text',
      link_description: '{{product.description}}',
      cards: [{
        body: 'Real primary copy text about bladder health.',
        link_title: 'Real Headline For Product',
        link_description: 'Valid guide overview',
      }],
    },
  }] } };
  const [ad] = extractAdsFromPayload(payload);
  assert.deepEqual(ad.ad_creative_bodies, ['Real primary copy text about bladder health.']);
  assert.deepEqual(ad.ad_creative_link_titles, ['Real Headline For Product']);
  assert.deepEqual(ad.ad_creative_link_descriptions, ['Valid guide overview']);

  const ranked = deduplicateAndRankAds([ad], { targetBrand: 'femicore' });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].copy.body, 'Real primary copy text about bladder health.');
  assert.equal(ranked[0].copy.headline, 'Real Headline For Product');
  assert.equal(ranked[0].copy.description, 'Valid guide overview');
});

test('EU transparency and flight dates are never assigned when no secondary copy exists', () => {
  const payload = { data: { ads: [{
    ad_archive_id: '999000222', page_name: 'FemiCore Brand',
    snapshot: {
      body: 'EU transparency',
      title: '12 ads use this creative and text',
      link_description: '{{product.description}}',
      cards: [],
    },
  }] } };
  const [ad] = extractAdsFromPayload(payload);
  assert.deepEqual(ad.ad_creative_bodies, []);
  assert.deepEqual(ad.ad_creative_link_titles, []);
  assert.deepEqual(ad.ad_creative_link_descriptions, []);

  const ranked = deduplicateAndRankAds([ad], { targetBrand: 'femicore' });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].copy.body, '');
  assert.equal(ranked[0].copy.headline, '');
  assert.equal(ranked[0].copy.description, '');
});

test('affiliate and niche offer queries retain candidate ads instead of dropping to zero', () => {
  const rawAds = [
    {
      id: '800000001',
      page_name: 'Bio Switch Nutrition',
      ad_creative_bodies: ['A retired Army Ranger built a box that pulls up to 30 gallons of drinking water a day straight out of the air.'],
      ad_creative_link_titles: ['No well. No plumbing. Water Freedom generator.'],
      ad_delivery_start_time: '2026-06-01T00:00:00.000Z',
    },
    {
      id: '800000002',
      page_name: 'Water Freedom System',
      ad_creative_bodies: ['Get complete water independence with our system.'],
      ad_creative_link_titles: ['Official Water Freedom System'],
      ad_delivery_start_time: '2026-06-01T00:00:00.000Z',
    },
    {
      id: '800000003',
      page_name: 'Romance Lovers Club',
      ad_creative_bodies: ['Chapter 12: The billionaire alpha werewolf forced her to marry him.'],
      ad_creative_link_titles: ['Read Full Novel'],
      ad_delivery_start_time: '2026-06-01T00:00:00.000Z',
    },
  ];

  const results = deduplicateAndRankAds(rawAds, {
    targetBrand: 'Water Freedom System',
    coreKeywords: ['water freedom system', 'water generator'],
    searchQuery: 'water freedom system',
  });

  // Continuous ranking retains discovered ads and ranks by relevance
  assert.equal(results.length, 3);
  // Official brand ad ranks first
  assert.equal(results[0].id, '800000002');
  assert.equal(results[0].ranking.relevanceType, 'OFFICIAL_BRAND');
  // Affiliate / related offer ad ranks second
  assert.equal(results[1].id, '800000001');
  assert.equal(results[1].ranking.relevanceType, 'RELATED_OFFER');
  // Off-topic or tangentially discovered ad ranks at the bottom with lowest relevance
  assert.equal(results[2].id, '800000003');
  assert.equal(results[2].ranking.relevanceType, 'DISCOVERED');
  assert.ok(results[0].ranking.rankScore > results[1].ranking.rankScore);
  assert.ok(results[1].ranking.rankScore > results[2].ranking.rankScore);
});

test('queries with multi-word terms like yu sleep retain discovered ads rather than returning empty', () => {
  const rawAds = [
    {
      id: '700000001',
      page_name: 'Siddhayu',
      ad_creative_bodies: ['Ayurveda that works for better sleep.'],
      ad_creative_link_titles: ['Sleep Yogue formula'],
      ad_delivery_start_time: '2026-04-15T00:00:00.000Z',
    },
  ];

  const results = deduplicateAndRankAds(rawAds, {
    targetBrand: 'Yu Sleep',
    coreKeywords: ['Yu Sleep Natural Sleep Drink Mix'],
    searchQuery: 'yu sleep',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, '700000001');
  assert.ok(['RELATED_OFFER', 'DISCOVERED'].includes(results[0].ranking.relevanceType));
});

test('niche queries in reading, entertainment, and finance are not dropped by hardcoded keyword filters', () => {
  const rawAds = [
    {
      id: '900000001',
      page_name: 'Alpha Webnovel Reader',
      ad_creative_bodies: ['Read 10,000+ chapter novels on your phone.'],
      ad_creative_link_titles: ['Best Novel App'],
      ad_delivery_start_time: '2026-05-01T00:00:00.000Z',
    },
    {
      id: '900000002',
      page_name: 'CEO Executive Coaching',
      ad_creative_bodies: ['Scale your enterprise with 1-on-1 billionaire mentorship.'],
      ad_creative_link_titles: ['Masterclass for CEOs'],
      ad_delivery_start_time: '2026-05-01T00:00:00.000Z',
    },
  ];

  const novelResults = deduplicateAndRankAds(rawAds, {
    targetBrand: 'Webnovel Reader',
    coreKeywords: ['novel', 'chapter', 'reader'],
    searchQuery: 'webnovel reader',
  });

  assert.equal(novelResults.length, 2);
  // The relevant ad ranks first
  assert.equal(novelResults[0].id, '900000001');
  assert.equal(novelResults[0].ranking.relevanceType, 'OFFICIAL_BRAND');
});

test('ads from disabled accounts or violating advertising standards are filtered from payload extraction', () => {
  const payload = {
    ads: [
      {
        ad_archive_id: '1429688922515262',
        page_name: 'Fresora',
        snapshot: {
          body: 'This ad was run by an account or Page we later disabled for not following our Advertising Standards.',
          title: 'Fresh Breath From the Source',
        },
      },
      {
        ad_archive_id: '1429688922515263',
        page_name: 'Fresora',
        is_account_disabled: true,
        snapshot: {
          body: 'Fresora probiotic mouthwash',
          title: 'Fresh Breath',
        },
      },
      {
        ad_archive_id: '1429688922515264',
        page_name: 'Fresora',
        snapshot: {
          body: 'Fresora ends the mouthwash-mask-repeat cycle with probiotics.',
          title: 'Fresh Breath From the Source',
        },
      },
    ],
  };

  const ads = extractAdsFromPayload(payload);
  assert.equal(ads.length, 1);
  assert.equal(ads[0].id, '1429688922515264');
});

test('deduplicateAndRankAds removes ads flagged with disabled account, removed ad, or advertising standards violation', () => {
  const rawAds = [
    {
      id: '1429688922515262',
      page_name: 'Fresora',
      ad_creative_bodies: ['This ad was run by an account or Page we later disabled for not following our Advertising Standards.'],
      ad_creative_link_titles: ['Fresh Breath From the Source'],
      ad_delivery_start_time: '2026-08-13T00:00:00.000Z',
    },
    {
      id: '1429688922515263',
      page_name: 'Fresora',
      isRemoved: true,
      ad_creative_bodies: ['Fresora probiotic mouthwash'],
      ad_creative_link_titles: ['Fresh Breath'],
      ad_delivery_start_time: '2026-08-13T00:00:00.000Z',
    },
    {
      id: '1429688922515264',
      page_name: 'Fresora',
      media: { status: 'removed', isRemoved: true },
      ad_creative_bodies: ['Fresora mouthwash'],
      ad_creative_link_titles: ['Fresh Breath'],
      ad_delivery_start_time: '2026-08-13T00:00:00.000Z',
    },
    {
      id: '1429688922515265',
      page_name: 'Fresora',
      ad_creative_bodies: ['Fresora ends the mouthwash-mask-repeat cycle with BLIS K12.'],
      ad_creative_link_titles: ['Fresh Breath From the Source'],
      ad_delivery_start_time: '2026-08-13T00:00:00.000Z',
    },
  ];

  const results = deduplicateAndRankAds(rawAds, {
    targetBrand: 'Fresora',
    searchQuery: 'fresora',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, '1429688922515265');
  assert.equal(isPresentableAd(rawAds[0]), false);
  assert.equal(isPresentableAd(rawAds[1]), false);
  assert.equal(isPresentableAd(rawAds[2]), false);
  assert.equal(isPresentableAd(results[0]), true);
});

