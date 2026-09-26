const { Firestore } = require('@google-cloud/firestore');
const { CloudTasksClient } = require('@google-cloud/tasks');
const { OAuth2Client } = require('google-auth-library');
const { createSearchId } = require('./search_logger');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';
const REGION = process.env.SEARCH_TASK_REGION || 'us-central1';
const QUEUE = process.env.SEARCH_TASK_QUEUE || 'ascendant-search';
const COLLECTION = 'search_jobs';
const SEARCH_ID = /^search_\d{13}_[a-f0-9]{20}$/;
const LEASE_MS = 120000;

class LeaseHeldError extends Error {}

class SearchJobs {
  constructor({ db, tasks, auth, now = Date.now, baseUrl, serviceAccount } = {}) {
    this.db = db || new Firestore({ projectId: PROJECT_ID });
    this.tasks = tasks || new CloudTasksClient();
    this.auth = auth || new OAuth2Client();
    this.now = now;
    this.baseUrl = baseUrl || process.env.SEARCH_WORKER_BASE_URL;
    this.serviceAccount = serviceAccount || process.env.SEARCH_WORKER_SERVICE_ACCOUNT;
  }

  doc(id) {
    if (!SEARCH_ID.test(id || '')) throw new Error('Invalid search ID');
    return this.db.collection(COLLECTION).doc(id);
  }

  async create(request) {
    if (!this.baseUrl || !this.serviceAccount) throw new Error('Search worker is not configured');
    const id = createSearchId();
    const createdAt = new Date(this.now()).toISOString();
    const doc = this.doc(id);
    await doc.create({ status: 'QUEUED', stage: 'queued', createdAt, attempts: 0,
      query: request.input, stageTimings: {}, resultCount: 0 });
    try {
      const parent = this.tasks.queuePath(PROJECT_ID, REGION, QUEUE);
      await this.tasks.createTask({ parent, task: {
        name: `${parent}/tasks/${id}`,
        httpRequest: {
          httpMethod: 'POST', url: `${this.baseUrl}/api/search-worker`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ ...request, searchId: id })).toString('base64'),
          oidcToken: { serviceAccountEmail: this.serviceAccount, audience: this.baseUrl },
        },
        dispatchDeadline: { seconds: 110 },
      } });
    } catch (error) {
      await doc.update({ status: 'FAILED', stage: 'enqueue_failed', completedAt: new Date(this.now()).toISOString(),
        error: 'Search could not be queued' });
      throw error;
    }
    return id;
  }

  async get(id) {
    const snap = await this.doc(id).get();
    if (!snap.exists) return null;
    const job = snap.data();
    return { searchId: id, status: job.status, stage: job.stage,
      createdAt: job.createdAt, startedAt: job.startedAt || null,
      completedAt: job.completedAt || null, attempts: job.attempts || 0,
      queueDelayMs: job.startedAt ? Date.parse(job.startedAt) - Date.parse(job.createdAt) : null,
      stageTimings: job.stageTimings || {}, resultCount: job.resultCount || 0,
      error: job.error || null, lastClientEvent: job.lastClientEvent || null };
  }

  async verifyWorker(req) {
    if (!this.baseUrl || !this.serviceAccount) return false;
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) return false;
    const ticket = await this.auth.verifyIdToken({ idToken: token, audience: this.baseUrl });
    return ticket.getPayload()?.email === this.serviceAccount &&
      ticket.getPayload()?.email_verified === true;
  }

  async claim(id) {
    const doc = this.doc(id);
    const now = this.now();
    const leaseToken = createSearchId();
    const claimed = await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(doc);
      if (!snap.exists) throw new Error('Search job does not exist');
      const job = snap.data();
      if (['SUCCEEDED', 'FAILED'].includes(job.status)) return false;
      if (job.status === 'RUNNING' && job.leaseUntil > now) throw new LeaseHeldError('Search already running');
      transaction.update(doc, { status: 'RUNNING', stage: 'starting',
        attempts: (job.attempts || 0) + 1, leaseToken, leaseUntil: now + LEASE_MS,
        startedAt: new Date(now).toISOString(), error: null });
      return true;
    });
    return claimed ? leaseToken : null;
  }

  async stage(id, leaseToken, stage, metrics = {}) {
    const doc = this.doc(id);
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(doc);
      if (snap.data()?.leaseToken !== leaseToken) return;
      transaction.update(doc, { stage, stageUpdatedAt: new Date(this.now()).toISOString(),
        stageTimings: metrics });
    });
  }

  async complete(id, leaseToken, { status, error = null, resultCount = 0, stageTimings = {} }) {
    const doc = this.doc(id);
    await this.db.runTransaction(async transaction => {
      const snap = await transaction.get(doc);
      if (snap.data()?.leaseToken !== leaseToken) return;
      transaction.update(doc, { status, stage: status === 'SUCCEEDED' ? 'complete' : 'failed',
        completedAt: new Date(this.now()).toISOString(), leaseUntil: 0,
        resultCount, error, stageTimings });
    });
  }

  async clientEvent(id, type, elapsedMs) {
    if (!['result_rendered', 'poll_failed'].includes(type)) throw new Error('Invalid client event');
    await this.doc(id).update({ lastClientEvent: {
      type, at: new Date(this.now()).toISOString(), elapsedMs: Math.max(0, Math.min(120000, Number(elapsedMs) || 0)),
    } });
  }
}

module.exports = { SearchJobs, LeaseHeldError, SEARCH_ID };
