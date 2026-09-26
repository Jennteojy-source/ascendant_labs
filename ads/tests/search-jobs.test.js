process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SearchJobs, LeaseHeldError } = require('../lib/search_jobs');

function fakeFirestore() {
  const records = new Map();
  const doc = id => ({
    async create(value) { if (records.has(id)) throw new Error('already exists'); records.set(id, value); },
    async get() { return { exists: records.has(id), data: () => records.get(id) }; },
    async update(value) { records.set(id, { ...records.get(id), ...value }); },
  });
  return {
    records,
    collection: () => ({ doc }),
    runTransaction: async callback => callback({
      get: reference => reference.get(),
      update: (reference, value) => reference.update(value),
    }),
  };
}

test('queued search has one worker, stage telemetry, durable completion, and a client receipt', async () => {
  const db = fakeFirestore();
  let task;
  let now = 1000;
  const jobs = new SearchJobs({ db,
    tasks: { queuePath: () => 'projects/test/locations/us-central1/queues/search',
      createTask: async request => { task = request.task; } },
    auth: {}, now: () => now,
    baseUrl: 'https://worker.example', serviceAccount: 'worker@example.iam.gserviceaccount.com',
  });
  const id = await jobs.create({ input: 'Yu Sleep', pageSize: 100 });
  assert.match(id, /^search_\d{13}_[a-f0-9]{20}$/);
  assert.equal((await jobs.get(id)).status, 'QUEUED');
  assert.equal(JSON.parse(Buffer.from(task.httpRequest.body, 'base64')).searchId, id);
  assert.equal(task.httpRequest.oidcToken.audience, 'https://worker.example');
  const lease = await jobs.claim(id);
  await assert.rejects(jobs.claim(id), LeaseHeldError);
  now = 2000;
  await jobs.stage(id, lease, 'ranking_ads', { queryExpansionMs: 1000 });
  assert.equal((await jobs.get(id)).stage, 'ranking_ads');
  await jobs.complete(id, lease, { status: 'SUCCEEDED', resultCount: 9,
    stageTimings: { totalMs: 1234 } });
  assert.equal(await jobs.claim(id), null);
  await jobs.clientEvent(id, 'result_rendered', 1500);
  const finished = await jobs.get(id);
  assert.equal(finished.status, 'SUCCEEDED');
  assert.equal(finished.resultCount, 9);
  assert.equal(finished.lastClientEvent.type, 'result_rendered');
  assert.equal(finished.stageTimings.totalMs, 1234);
});

test('expired worker lease can be claimed by a task retry without stale writes', async () => {
  const db = fakeFirestore();
  let now = 1000;
  const jobs = new SearchJobs({ db,
    tasks: { queuePath: () => 'queue', createTask: async () => {} }, auth: {}, now: () => now,
    baseUrl: 'https://worker.example', serviceAccount: 'worker@example.iam.gserviceaccount.com',
  });
  const id = await jobs.create({ input: 'Energy Revolution System' });
  const staleLease = await jobs.claim(id);
  now = 122000;
  const newLease = await jobs.claim(id);
  assert.notEqual(newLease, staleLease);
  await jobs.stage(id, staleLease, 'stale', {});
  assert.equal((await jobs.get(id)).stage, 'starting');
  await jobs.complete(id, newLease, { status: 'FAILED', error: 'Meta unavailable' });
  assert.equal((await jobs.get(id)).error, 'Meta unavailable');
});
