/**
 * Persistent Search History & Results Logger (Firestore + Local JSON Fallback)
 * Ascendant Labs / Intelligence Logging & Replay Engine
 * 
 * Logs all search queries and their ranked ad results to Firestore table 'search_history'.
 * Allows historical review, analytics, and instant zero-latency replays.
 */

const fs = require('fs');
const path = require('path');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const LOCAL_HISTORY_FILE = path.join(CACHE_DIR, 'search_history.json');
const COLLECTION_NAME = 'search_history';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

let firestoreInstance = null;
let firestoreAvailable = null;

function getFirestore() {
  if (!firestoreInstance) {
    try {
      firestoreInstance = new Firestore({
        projectId: PROJECT_ID,
      });
    } catch (err) {
      console.warn('[SearchLogger] Failed to initialize Firestore client:', err.message);
      firestoreAvailable = false;
    }
  }
  return firestoreInstance;
}

/**
 * Sanitize an ad object for Firestore storage (remove undefined / circular props)
 */
function sanitizeAdForStorage(ad) {
  if (!ad) return null;
  return {
    id: String(ad.id || ''),
    pageId: String(ad.pageId || ''),
    pageName: ad.pageName || 'Advertiser',
    adSnapshotUrl: ad.adSnapshotUrl || null,
    destinationUrl: ad.destinationUrl || null,
    displayDomain: ad.displayDomain || null,
    ctaText: ad.ctaText || 'Learn More',
    copy: {
      headline: ad.copy?.headline || '',
      body: ad.copy?.body || '',
      caption: ad.copy?.caption || '',
    },
    stats: {
      flightDays: Number(ad.stats?.flightDays || 1),
      isActive: ad.stats?.isActive !== false,
      startDate: ad.stats?.startDate || null,
      endDate: ad.stats?.endDate || null,
      scaleTier: ad.stats?.scaleTier || 'Active',
      reachEst: ad.stats?.reachEst || 'Standard',
    },
    media: {
      mediaType: ad.media?.mediaType || 'IMAGE',
      thumbnailUrl: ad.media?.thumbnailUrl || null,
      videoUrl: ad.media?.videoUrl || null,
    },
    ranking: {
      rankScore: Number(ad.ranking?.rankScore || ad.ranking?.score || 50),
      relevanceScore: Number(ad.ranking?.relevanceScore || 50),
      relationship: ad.ranking?.relationship || 'COMPETITOR',
      relevanceType: ad.ranking?.relevanceType || 'COMPETITOR',
    },
    aiAnalysis: ad.aiAnalysis ? {
      relationship: ad.aiAnalysis.relationship || 'COMPETITOR',
      creativeAngle: ad.aiAnalysis.creativeAngle || 'Direct Response',
      aiInsight: ad.aiAnalysis.aiInsight || '',
    } : null,
    variantCount: Number(ad.variantCount || 1),
  };
}

/**
 * Log a completed search session to Firestore & local disk
 */
async function logSearchSession(sessionData = {}) {
  const {
    query = '',
    searchType = 'auto',
    profile = null,
    ads = [],
    totalFound = 0,
    latencyMs = 0,
    clientIp = null,
    userAgent = null,
  } = sessionData;

  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return null;

  const id = `search_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sanitizedAds = (ads || []).slice(0, 80).map(sanitizeAdForStorage).filter(Boolean);

  const docData = {
    id,
    query: trimmedQuery,
    normalizedQuery: trimmedQuery.toLowerCase(),
    searchType,
    totalFound: totalFound || sanitizedAds.length,
    returnedCount: sanitizedAds.length,
    profile: profile ? {
      brandName: profile.brandName || '',
      domain: profile.domain || '',
      category: profile.category || '',
      coreProduct: profile.coreProduct || '',
      suggestedVectors: profile.suggestedVectors || [],
    } : null,
    results: sanitizedAds,
    metadata: {
      latencyMs,
      clientIp: clientIp || null,
      userAgent: userAgent ? userAgent.substring(0, 200) : null,
      loggedAt: new Date().toISOString(),
    },
  };

  // 1. Save to local fallback cache
  try {
    let localHistory = [];
    if (fs.existsSync(LOCAL_HISTORY_FILE)) {
      try {
        localHistory = JSON.parse(fs.readFileSync(LOCAL_HISTORY_FILE, 'utf8'));
      } catch (e) {
        localHistory = [];
      }
    }
    // Prepend new search, keep last 100
    localHistory.unshift({
      id: docData.id,
      query: docData.query,
      timestamp: docData.metadata.loggedAt,
      totalFound: docData.totalFound,
      brandName: docData.profile?.brandName || docData.query,
      category: docData.profile?.category || '',
      resultsCount: docData.returnedCount,
      results: docData.results,
      profile: docData.profile,
    });
    if (localHistory.length > 100) localHistory = localHistory.slice(0, 100);
    fs.writeFileSync(LOCAL_HISTORY_FILE, JSON.stringify(localHistory, null, 2), 'utf8');
  } catch (err) {
    console.warn('[SearchLogger] Local history file write notice:', err.message);
  }

  // 2. Save to Google Cloud Firestore
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      await docRef.set({
        ...docData,
        createdAt: FieldValue.serverTimestamp(),
      });
      firestoreAvailable = true;
      console.log(`[SearchLogger] Logged query "${trimmedQuery}" to Firestore (${docData.returnedCount} ads, ID: ${id})`);
      return id;
    } catch (err) {
      console.warn('[SearchLogger] Firestore write notice (saved locally):', err.message);
      firestoreAvailable = false;
    }
  }

  return id;
}

/**
 * Retrieve recent search queries for review / replay list
 */
async function getRecentSearches(limit = 25) {
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const snapshot = await db.collection(COLLECTION_NAME)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      if (!snapshot.empty) {
        firestoreAvailable = true;
        return snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            query: d.query,
            totalFound: d.totalFound || (d.results ? d.results.length : 0),
            brandName: d.profile?.brandName || d.query,
            category: d.profile?.category || '',
            domain: d.profile?.domain || '',
            timestamp: d.metadata?.loggedAt || (d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString()),
          };
        });
      }
    } catch (err) {
      console.warn('[SearchLogger] Firestore getRecentSearches notice, using local cache:', err.message);
      firestoreAvailable = false;
    }
  }

  // Fallback to local history
  if (fs.existsSync(LOCAL_HISTORY_FILE)) {
    try {
      const list = JSON.parse(fs.readFileSync(LOCAL_HISTORY_FILE, 'utf8'));
      return list.slice(0, limit).map(item => ({
        id: item.id,
        query: item.query,
        totalFound: item.totalFound,
        brandName: item.brandName,
        category: item.category,
        domain: item.profile?.domain || '',
        timestamp: item.timestamp,
      }));
    } catch (e) {}
  }

  return [];
}

/**
 * Retrieve a specific search session by ID for instant replay
 */
async function getSearchSession(id) {
  if (!id) return null;

  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const doc = await db.collection(COLLECTION_NAME).doc(id).get();
      if (doc.exists) {
        firestoreAvailable = true;
        return doc.data();
      }
    } catch (err) {
      console.warn(`[SearchLogger] Firestore getSearchSession notice for ${id}:`, err.message);
      firestoreAvailable = false;
    }
  }

  // Fallback to local history
  if (fs.existsSync(LOCAL_HISTORY_FILE)) {
    try {
      const list = JSON.parse(fs.readFileSync(LOCAL_HISTORY_FILE, 'utf8'));
      const found = list.find(item => item.id === id);
      if (found) {
        return {
          id: found.id,
          query: found.query,
          totalFound: found.totalFound,
          profile: found.profile,
          results: found.results,
          metadata: { loggedAt: found.timestamp },
        };
      }
    } catch (e) {}
  }

  return null;
}

module.exports = {
  logSearchSession,
  getRecentSearches,
  getSearchSession,
};
