const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { logSearchSession, getRecentSearches, getSearchDiagnostics } = require('../lib/search_logger');

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
