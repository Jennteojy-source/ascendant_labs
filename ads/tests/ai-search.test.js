process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSearchVectors } = require('../lib/ai_query_expander');
const { sanitizeAgentQueries } = require('../lib/ai_retrieval_agent');
const { rerankAdsWithAI, evaluateBatchWithAI, isSearchMatch } = require('../lib/ai_reranker');
const { buildRetrievalPlan } = require('../lib/comparable_finder');

function ad(id, pageName, body) {
  return {
    id: String(id), pageName, page_name: pageName,
    copy: { headline: '', body, caption: '', description: '' },
    ranking: { relevanceType: 'DISCOVERED', relevanceScore: 45 },
    stats: { isActive: true, flightDays: 1 }, variantCount: 1,
  };
}

test('grounded aliases can drive retrieval without broad category drift', () => {
  const vectors = sanitizeSearchVectors('Yu Sleep', [
    { type: 'ALIAS', query: 'Restora Night' },
    { type: 'CATEGORY', query: 'sleep supplement' },
  ], { aliases: ['Restora Night'] });
  assert.deepEqual(vectors.map(item => item.query), ['Yu Sleep', 'Restora Night']);
  assert.deepEqual(sanitizeAgentQueries([
    { type: 'ALIAS', query: 'Restora Night official' },
    { type: 'CATEGORY', query: 'sleep supplements' },
  ], 'Yu Sleep', 2, { aliases: ['Restora Night'], intentType: 'NAMED_OFFER' })
    .map(item => item.query), ['Restora Night official']);
});

test('Gemini judges every candidate and rejects broad matches for a named offer', async () => {
  const candidates = Array.from({ length: 48 }, (_, i) => ad(i + 1, `Advertiser ${i + 1}`, 'Sleep tonight'));
  candidates[47] = ad(48, 'Independent Review', 'Restora Night supplement review');
  const batches = [];
  const ranked = await rerankAdsWithAI(candidates, {
    brandName: 'Yu Sleep', aliases: ['Restora Night'], intentType: 'NAMED_OFFER',
  }, { evaluateBatch: async (_profile, batch) => {
    batches.push(batch.map(item => item.id));
    return batch.map(item => ({
      id: item.id, relationship: item.id === '48' ? 'REVIEW_EDITORIAL' : 'RELATED_OFFER',
      relevanceScore: item.id === '48' ? 88 : 60, reason: 'Copy evidence',
    }));
  } });
  assert.equal(batches.flat().length, 48);
  assert.equal(ranked[0].id, '48');
  assert.deepEqual(ranked.filter(item => isSearchMatch(item, { intentType: 'NAMED_OFFER' }))
    .map(item => item.id), ['48']);
});

test('failed Gemini evaluation withholds an unrelated candidate', async () => {
  const ranked = await rerankAdsWithAI([ad(1, 'Solar Store', 'Energy for the home')], {
    brandName: 'Energy Revolution System', intentType: 'NAMED_OFFER',
  }, { evaluateBatch: async () => null });
  assert.equal(isSearchMatch(ranked[0], { intentType: 'NAMED_OFFER' }), false);
});

test('AI judge receives options and actually calls the model', async () => {
  let calls = 0;
  const result = await evaluateBatchWithAI({ brandName: 'ProDentim' },
    [ad(1, 'ProDentim', 'ProDentim oral probiotic')], {
      timeoutMs: 1234,
      generateText: async (_prompt, _config, meta) => {
        calls++;
        assert.equal(meta.timeoutMs, 1234);
        return JSON.stringify([{ id: '1', relationship: 'OFFICIAL_BRAND',
          relevanceScore: 98, reason: 'Product named in page and copy' }]);
      },
    });
  assert.equal(calls, 1);
  assert.equal(result[0].relationship, 'OFFICIAL_BRAND');
});

test('multiword offers get a precise phrase search alongside broad search', () => {
  const plan = buildRetrievalPlan([
    { type: 'EXACT_BRAND', query: 'Energy Revolution System', countries: ['ALL'] },
  ], 4, { precisePhrase: true });
  assert.deepEqual(plan.slice(0, 2).map(item => item.searchType || 'keyword_unordered'),
    ['keyword_unordered', 'keyword_exact_phrase']);
});

test('unified results search active ads first and preserve archive coverage', () => {
  const plan = buildRetrievalPlan([
    { type: 'EXACT_BRAND', query: 'ProDentim', countries: ['ALL'] },
  ], 4, { includeArchive: true });
  assert.deepEqual(plan.map(item => [item.type, item.status]), [
    ['EXACT_BRAND', 'ACTIVE'], ['ARCHIVE_EXACT', 'ALL'],
  ]);
});

test('active exact-product creative outranks an inactive long-running creative', async () => {
  const active = ad(1, 'ProDentim', 'ProDentim oral probiotic');
  const inactive = ad(2, 'ProDentim', 'ProDentim oral probiotic');
  active.stats.flightDays = 1;
  inactive.stats = { isActive: false, flightDays: 365 };
  const ranked = await rerankAdsWithAI([inactive, active], {
    brandName: 'ProDentim', intentType: 'NAMED_OFFER',
  }, { evaluateBatch: async (_profile, batch) => batch.map(item => ({
    id: item.id, relationship: 'OFFICIAL_BRAND', relevanceScore: 98, reason: 'Exact product',
  })) });
  assert.equal(ranked[0].id, '1');
});
