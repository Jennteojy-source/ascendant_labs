/** Short-lived cache of ad-bound media descriptors (not media bytes). */
const fs = require('fs');
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');
const { MEDIA_SCHEMA_VERSION, MEDIA_CACHE_TTL_MS, DURABLE_MEDIA_CACHE_TTL_MS,
  mediaResult, isAvatarUrl, isUrlExpired } = require('./media_resolver');

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const FALLBACK_CACHE_FILE = path.join(CACHE_DIR, 'media_cache.json');
const COLLECTION_NAME = 'ad_media_cache';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';
const memoryCache = new Map();
let firestoreInstance;
let retryFirestoreAt = 0;

function normalizeCacheEntry(entry, now = Date.now()) {
  // Old entries were selected from unscoped network traffic; do not perpetuate them.
  const ttl = ['ready', 'partial'].includes(entry?.storageStatus) ? DURABLE_MEDIA_CACHE_TTL_MS : MEDIA_CACHE_TTL_MS;
  if (!entry || entry.schemaVersion !== MEDIA_SCHEMA_VERSION || !Number.isFinite(entry.cachedAt)
      || now - entry.cachedAt > ttl || entry.cachedAt > now + 60000) return null;
  const items = (entry.creatives || [entry]).map(c => ({ ...c,
    thumbnailUrl: isUrlExpired(c.thumbnailUrl, now) ? null : c.thumbnailUrl,
    imageSources: (c.imageSources || []).filter(u => !isUrlExpired(u, now)),
    videoUrl: isUrlExpired(c.videoUrl, now) ? null : c.videoUrl,
    videoSources: (c.videoSources || []).filter(u => !isUrlExpired(u, now)),
  }));
  const media = mediaResult(items, entry.source);
  return media.status === 'ready' ? {
    ...media, cachedAt: entry.cachedAt,
    storageStatus: entry.storageStatus || null,
    storedAt: entry.storedAt || null,
  } : null;
}

function getFirestore() {
  if (process.env.MEDIA_FIRESTORE_DISABLED === '1' || Date.now() < retryFirestoreAt) return null;
  if (!firestoreInstance) firestoreInstance = new Firestore({ projectId: PROJECT_ID });
  return firestoreInstance;
}
function remember(id, entry) {
  memoryCache.delete(id);
  memoryCache.set(id, entry);
  while (memoryCache.size > 500) memoryCache.delete(memoryCache.keys().next().value);
}
try {
  const entries = JSON.parse(fs.readFileSync(FALLBACK_CACHE_FILE, 'utf8'));
  for (const [id, raw] of Object.entries(entries)) {
    const entry = normalizeCacheEntry(raw);
    if (entry) remember(id, entry);
  }
} catch { /* First run or unreadable local cache. */ }

async function getCachedMediaBatch(adIds = []) {
  const results = {};
  const missing = [];
  for (const id of [...new Set(adIds.map(String))]) {
    const entry = normalizeCacheEntry(memoryCache.get(id));
    if (entry) { remember(id, entry); results[id] = entry; }
    else { memoryCache.delete(id); missing.push(id); }
  }
  const db = missing.length ? getFirestore() : null;
  if (db) {
    try {
      for (let i = 0; i < missing.length; i += 30) {
        const docs = await db.getAll(...missing.slice(i, i + 30).map(id => db.collection(COLLECTION_NAME).doc(id)));
        for (const doc of docs) {
          const entry = doc.exists && normalizeCacheEntry(doc.data());
          if (entry) { remember(doc.id, entry); results[doc.id] = entry; }
        }
      }
    } catch {
      retryFirestoreAt = Date.now() + 60000;
      console.warn('[MediaCache] Firestore unavailable; using local cache for one minute.');
    }
  }
  return results;
}

async function saveMediaBatch(entries = {}) {
  const valid = [];
  for (const [id, media] of Object.entries(entries)) {
    const entry = normalizeCacheEntry({ ...media, cachedAt: Date.now() });
    if (entry) { remember(String(id), entry); valid.push([String(id), entry]); }
  }
  if (!valid.length) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(FALLBACK_CACHE_FILE, JSON.stringify(Object.fromEntries(memoryCache)), 'utf8');
  } catch { /* Disk cache is optional on ephemeral workers. */ }
  const db = getFirestore();
  if (db) {
    try {
      for (let i = 0; i < valid.length; i += 400) {
        const batch = db.batch();
        for (const [id, entry] of valid.slice(i, i + 400)) batch.set(db.collection(COLLECTION_NAME).doc(id), { ...entry, adId: id });
        await batch.commit();
      }
    } catch {
      retryFirestoreAt = Date.now() + 60000;
      console.warn('[MediaCache] Firestore write unavailable; descriptors saved locally.');
    }
  }
}

async function testConnection() {
  const db = getFirestore();
  if (!db) return { success: false, reason: 'Cache storage temporarily unavailable' };
  try {
    await db.collection(COLLECTION_NAME).limit(1).get();
    return { success: true, projectId: PROJECT_ID };
  } catch { return { success: false, reason: 'Firestore read failed' }; }
}
module.exports = { getCachedMediaBatch, saveMediaBatch, testConnection, normalizeCacheEntry,
  isUrlExpired, isAvatarUrl, memoryCache };
