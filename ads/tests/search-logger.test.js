process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { logSearchSession, createSearchId, recordSearchEvent, getSearchEvaluation,
  getRecentSearches, getSearchDiagnostics } = require('../lib/search_logger');
const { buildSearchEvaluation } = require('../lib/search_evaluation');

test('search logger records successful searches with ad summaries', async () => {
  const query = 'unit_test_pillow_' + Date.now();
  const sampleAd = {
    id: '12345678',
    pageName: 'Sleep Brand',
    copy: { headline: 'Best Pillow 2026', body: 'Sleep deeply all night.' },
    ctaText: 'Shop Now',
    media: { mediaType: 'image', thumbnailUrl: 'https://scontent.xx.fbcdn.net/img.jpg' },
    stats: { isActive: true, flightDays: 30, scaleTier: 'High Scale' },
  };

  const docId = await logSearchSession({
    query,
    status: 'SUCCESS',
    isBlocked: false,
    searchParams: { countries: ['US'], status: 'ACTIVE', mediaType: 'ALL' },
    profile: { brandName: 'Sleep Brand', category: 'Health' },
    ads: [sampleAd],
    totalFound: 1,
    returnedCount: 1,
    latencyMs: 1500,
    clientIp: '127.0.0.1',
    userAgent: 'test-agent',
  });

  assert.ok(docId.startsWith('search_'));
  const recent = await getRecentSearches(10);
  const found = recent.find(r => r.query === query);
  assert.ok(found, 'query found in recent searches');
  assert.equal(found.status, 'SUCCESS');
  assert.equal(found.isBlocked, false);
  assert.equal(found.totalFound, 1);
  assert.equal(found.topResultsSummary.length, 1);
  assert.equal(found.topResultsSummary[0].headline, 'Best Pillow 2026');
  assert.equal(found.topResultsSummary[0].hasMedia, true);
});

test('search logger records blocked sessions with diagnostics', async () => {
  const query = 'unit_test_blocked_' + Date.now();

  const docId = await logSearchSession({
    query,
    status: 'BLOCKED',
    isBlocked: true,
    blockReason: 'HTTP 403 received from Meta',
    errorMessage: 'Meta blocked the browser session',
    searchParams: { countries: ['US'], status: 'ACTIVE', mediaType: 'ALL' },
    vectorHits: { 'unit_test_blocked': 0 },
    discoveryErrors: [{ term: 'unit_test_blocked', error: 'HTTP 403 received from Meta', blocked: true }],
    ads: [],
    totalFound: 0,
    latencyMs: 2200,
    clientIp: '127.0.0.1',
    userAgent: 'test-agent',
  });

  assert.ok(docId.startsWith('search_'));
  const recent = await getRecentSearches(10, { isBlocked: true });
  const found = recent.find(r => r.query === query);
  assert.ok(found, 'blocked query found when filtering isBlocked: true');
  assert.equal(found.status, 'BLOCKED');
  assert.equal(found.isBlocked, true);
  assert.equal(found.blockReason, 'HTTP 403 received from Meta');
  assert.equal(found.discoveryErrors.length, 1);
});

test('getSearchDiagnostics aggregates system telemetry', async () => {
  const diagnostics = await getSearchDiagnostics(15);
  assert.ok(diagnostics.summary);
  assert.equal(typeof diagnostics.summary.totalLogged, 'number');
  assert.equal(typeof diagnostics.summary.blockedCount, 'number');
  assert.equal(typeof diagnostics.summary.successCount, 'number');
  assert.ok(typeof diagnostics.summary.blockedRate, 'string');
  assert.ok(Array.isArray(diagnostics.recentSearches));
});

test('evaluation links retrieval, ranking decisions, and media outcomes by search ID', async () => {
  const id = createSearchId();
  const raw = [
    { id: '12345678', matchedQueries: ['prodentim'], discoveryVectors: ['EXACT_BRAND'],
      browserMedia: { status: 'ready' } },
    { id: '87654321', matchedQueries: ['prodentim'], discoveryVectors: ['EXACT_BRAND'] },
  ];
  const ranked = [{ id: '12345678', ranking: { rankScore: 120, relevanceScore: 90,
    relationship: 'AFFILIATE_PARTNER', reason: 'Product named in headline' } }];
  const evaluation = buildSearchEvaluation({ rawAds: raw, deterministicAds: ranked,
    rerankedAds: ranked, returnedAds: ranked, retrievalAttempts: [{ query: 'prodentim', resultCount: 2 }] });
  await logSearchSession({ id, query: 'prodentim', ads: ranked, evaluation });
  assert.equal(await recordSearchEvent(id, { type: 'media_resolved', adId: '12345678',
    mediaStatus: 'blocked', httpStatus: 403, reason: 'meta_http_403',
    assetHost: 'scontent.xx.fbcdn.net', url: 'https://secret.example/token=abc' }), true);
  const report = await getSearchEvaluation(id);
  assert.equal(report.searchId, id);
  assert.equal(report.evaluation.candidates[0].fate, 'returned');
  assert.equal(report.evaluation.candidates[1].fate, 'removed_before_ranking');
  assert.equal(report.events[0].httpStatus, 403);
  assert.equal(JSON.stringify(report).includes('secret.example'), false);
  assert.equal(await recordSearchEvent(id, { type: 'arbitrary', adId: '12345678' }), false);
  assert.equal(await recordSearchEvent('search_1234567890123_0123456789abcdef0123',
    { type: 'asset_loaded', adId: '12345678' }), false);
});
