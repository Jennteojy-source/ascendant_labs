/**
 * Persistent Zero-Cost Media Cache (Firestore Native + In-Memory + Disk Fallback)
 * Ascendant Labs / Media Sniffing Optimization Engine
 * 
 * Features:
 * - Backed by Google Cloud Firestore (Always Free Tier: 50,000 reads / 20,000 writes per day)
 * - In-memory LRU cache for 0ms sub-millisecond local reads
 * - Automatic URL expiration check (?oe= hex timestamp)
 * - Seamless fallback to local JSON cache (media_cache.json) if Firestore is unreachable
 * - Batch operations via Firestore getAll() for minimal latency
 */

const fs = require('fs');
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const FALLBACK_CACHE_FILE = path.join(CACHE_DIR, 'media_cache.json');
const COLLECTION_NAME = 'ad_media_cache';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// In-memory cache for 0ms local reads
const memoryCache = new Map();
let firestoreInstance = null;
let firestoreAvailable = null; // null = untested, true = connected, false = fallback

function isAvatarUrl(url) {
  if (!url) return false;
  return /s60x60|s150x150|s206x206|p50x50|p100x100|profile_pic|t51\.82787|_8nqq/i.test(url);
}

/**
 * Check if a Meta signed CDN URL has expired (oe= parameter is a hex timestamp)
 */
function isUrlExpired(url) {
  if (!url) return false;
  const match = url.match(/[?&]oe=([0-9a-fA-F]+)/);
  if (match) {
    const expirySec = parseInt(match[1], 16);
    if (!isNaN(expirySec) && (Date.now() / 1000) > (expirySec - 3600)) {
      return true; // Expired or expiring within 1 hour
    }
  }
  return false;
}

function getFirestore() {
  if (!firestoreInstance) {
    try {
      firestoreInstance = new Firestore({
        projectId: PROJECT_ID,
      });
    } catch (err) {
      console.warn('[FirestoreCache] Failed to initialize Firestore client, using local cache fallback:', err.message);
      firestoreAvailable = false;
    }
  }
  return firestoreInstance;
}

// Load local fallback cache
function loadLocalFallback() {
  if (fs.existsSync(FALLBACK_CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(FALLBACK_CACHE_FILE, 'utf8'));
      for (const [id, entry] of Object.entries(data)) {
        if (!isUrlExpired(entry.thumbnailUrl) && !isUrlExpired(entry.videoUrl)) {
          memoryCache.set(String(id), entry);
        }
      }
    } catch (e) {}
  }
}
loadLocalFallback();

function saveLocalFallback() {
  try {
    const obj = {};
    for (const [k, v] of memoryCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(FALLBACK_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Retrieve cached media for a list of ad IDs
 * @param {string[]} adIds
 * @returns {Promise<Record<string, { thumbnailUrl: string, videoUrl: string, mediaType: string }>>}
 */
async function getCachedMediaBatch(adIds = []) {
  const results = {};
  const missingFromMemory = [];

  // 1. Check in-memory cache first (0ms)
  for (const adId of adIds) {
    const idStr = String(adId);
    if (memoryCache.has(idStr)) {
      const entry = memoryCache.get(idStr);
      if (
        (entry.thumbnailUrl && isAvatarUrl(entry.thumbnailUrl)) ||
        isUrlExpired(entry.thumbnailUrl) ||
        isUrlExpired(entry.videoUrl)
      ) {
        memoryCache.delete(idStr);
        missingFromMemory.push(idStr);
      } else {
        results[idStr] = entry;
      }
    } else {
      missingFromMemory.push(idStr);
    }
  }

  if (missingFromMemory.length === 0) {
    return results;
  }

  // 2. Query Firestore for missing items
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const refs = missingFromMemory.map(id => db.collection(COLLECTION_NAME).doc(id));
      // Chunk into 30 docs max for getAll
      const chunkSize = 30;
      for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        const docs = await db.getAll(...chunk);
        
        for (const doc of docs) {
          if (doc.exists) {
            const data = doc.data();
            const id = doc.id;
            const isBad = (data.thumbnailUrl && isAvatarUrl(data.thumbnailUrl)) ||
                          isUrlExpired(data.thumbnailUrl) ||
                          isUrlExpired(data.videoUrl);

            if (!isBad && data.mediaType !== 'unknown') {
              const entry = {
                thumbnailUrl: data.thumbnailUrl || null,
                videoUrl: data.videoUrl || null,
                mediaType: data.mediaType || 'unknown',
                cachedAt: data.cachedAt || Date.now(),
              };
              results[id] = entry;
              memoryCache.set(id, entry);
            }
          }
        }
      }
      firestoreAvailable = true;
    } catch (err) {
      console.warn('[FirestoreCache] Firestore read notice, falling back to memory/local:', err.message);
      firestoreAvailable = false;
    }
  }

  return results;
}

/**
 * Save media entries to cache (In-memory + Firestore + Local fallback)
 * @param {Record<string, { thumbnailUrl: string, videoUrl: string, mediaType: string }>>} entries
 */
async function saveMediaBatch(entries = {}) {
  const entriesToSave = Object.entries(entries).filter(([_, m]) => m && m.mediaType !== 'unknown');
  if (entriesToSave.length === 0) return;

  // 1. Update in-memory & local fallback
  for (const [id, media] of entriesToSave) {
    const entry = {
      thumbnailUrl: media.thumbnailUrl || null,
      videoUrl: media.videoUrl || null,
      mediaType: media.mediaType,
      cachedAt: Date.now(),
    };
    memoryCache.set(String(id), entry);
  }
  saveLocalFallback();

  // 2. Write to Firestore in batches
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const batch = db.batch();
      for (const [id, media] of entriesToSave) {
        const docRef = db.collection(COLLECTION_NAME).doc(String(id));
        batch.set(docRef, {
          adId: String(id),
          thumbnailUrl: media.thumbnailUrl || null,
          videoUrl: media.videoUrl || null,
          mediaType: media.mediaType,
          cachedAt: Date.now(),
        }, { merge: true });
      }
      await batch.commit();
      firestoreAvailable = true;
    } catch (err) {
      console.warn('[FirestoreCache] Firestore write notice (cached locally):', err.message);
    }
  }
}

/**
 * Diagnostic connection test
 */
async function testConnection() {
  const db = getFirestore();
  if (!db) return { success: false, reason: 'Client uninitialized' };
  try {
    const testDoc = db.collection(COLLECTION_NAME).doc('healthcheck_test');
    await testDoc.set({ ping: Date.now() });
    const snap = await testDoc.get();
    return {
      success: true,
      exists: snap.exists,
      data: snap.data(),
      projectId: PROJECT_ID,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getCachedMediaBatch,
  saveMediaBatch,
  testConnection,
  isUrlExpired,
  isAvatarUrl,
  memoryCache,
};
