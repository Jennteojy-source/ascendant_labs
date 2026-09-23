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
 * Log a completed or attempted search session to Firestore & local disk.
 * Supports status: 'SUCCESS' | 'BLOCKED' | 'ERROR' | 'PARTIAL'
 */
async function logSearchSession(sessionData = {}) {
  const {
    query = '',
    status = 'SUCCESS',
    isBlocked = false,
    blockReason = null,
    errorMessage = null,
    searchType = 'ai_expanded',
    searchParams = null,
    profile = null,
    ads = [],
    totalFound = 0,
    returnedCount = 0,
    vectorHits = {},
    discoveryErrors = [],
    collector = null,
    latencyMs = 0,
    clientIp = null,
    userAgent = null,
  } = sessionData;

  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return null;

  const id = `search_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sanitizedAds = (ads || []).slice(0, 80).map(sanitizeAdForStorage).filter(Boolean);

  const topResultsSummary = sanitizedAds.slice(0, 10).map(ad => ({
    id: ad.id,
    pageName: ad.pageName,
    headline: ad.copy?.headline || '',
    ctaText: ad.ctaText,
    mediaType: ad.media?.mediaType || 'unknown',
    hasMedia: !!(ad.media?.thumbnailUrl || ad.media?.videoUrl),
    isActive: ad.stats?.isActive !== false,
    scaleTier: ad.stats?.scaleTier || 'Standard',
  }));

  const effectiveStatus = isBlocked ? 'BLOCKED' : status;

  const docData = {
    id,
    query: trimmedQuery,
    normalizedQuery: trimmedQuery.toLowerCase(),
    status: effectiveStatus,
    isBlocked: Boolean(isBlocked),
    blockReason: blockReason || null,
    errorMessage: errorMessage || null,
    searchType,
    searchParams: searchParams || null,
    totalFound: totalFound !== undefined ? totalFound : sanitizedAds.length,
    returnedCount: returnedCount !== undefined ? returnedCount : sanitizedAds.length,
    vectorHits: vectorHits || {},
    discoveryErrors: discoveryErrors || [],
    profile: profile ? {
      brandName: profile.brandName || '',
      domain: profile.domain || '',
      category: profile.category || '',
      coreProduct: profile.coreProduct || '',
      suggestedVectors: profile.suggestedVectors || [],
    } : null,
    topResultsSummary,
    results: sanitizedAds,
    metadata: {
      collector: collector || (process.env.BROWSERLESS_TOKEN ? 'managed-browserless'
        : process.env.BROWSER_WS_ENDPOINT ? 'managed-playwright' : 'headless-chromium'),
      environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
      latencyMs: Number(latencyMs) || 0,
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
      status: docData.status,
      isBlocked: docData.isBlocked,
      blockReason: docData.blockReason,
      errorMessage: docData.errorMessage,
      timestamp: docData.metadata.loggedAt,
      totalFound: docData.totalFound,
      returnedCount: docData.returnedCount,
      brandName: docData.profile?.brandName || docData.query,
      category: docData.profile?.category || '',
      vectorHits: docData.vectorHits,
      discoveryErrors: docData.discoveryErrors,
      collector: docData.metadata.collector,
      latencyMs: docData.metadata.latencyMs,
      topResultsSummary: docData.topResultsSummary,
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
      console.log(`[SearchLogger] Logged query "${trimmedQuery}" to Firestore (${docData.returnedCount} ads, status: ${effectiveStatus}, ID: ${id})`);
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
async function getRecentSearches(limit = 25, options = {}) {
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const fetchLimit = (options.status || typeof options.isBlocked === 'boolean') ? Math.max(limit * 3, 60) : limit;
      const snapshot = await db.collection(COLLECTION_NAME)
        .orderBy('createdAt', 'desc')
        .limit(fetchLimit)
        .get();

      if (!snapshot.empty) {
        firestoreAvailable = true;
        let docs = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            query: d.query,
            status: d.status || (d.isBlocked ? 'BLOCKED' : 'SUCCESS'),
            isBlocked: Boolean(d.isBlocked),
            blockReason: d.blockReason || null,
            errorMessage: d.errorMessage || null,
            totalFound: d.totalFound || (d.results ? d.results.length : 0),
            returnedCount: d.returnedCount || (d.results ? d.results.length : 0),
            brandName: d.profile?.brandName || d.query,
            category: d.profile?.category || '',
            domain: d.profile?.domain || '',
            vectorHits: d.vectorHits || {},
            discoveryErrors: d.discoveryErrors || [],
            collector: d.metadata?.collector || 'unknown',
            latencyMs: d.metadata?.latencyMs || 0,
            topResultsSummary: d.topResultsSummary || [],
            timestamp: d.metadata?.loggedAt || (d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString()),
          };
        });

        if (options.status) docs = docs.filter(item => item.status === options.status);
        if (typeof options.isBlocked === 'boolean') docs = docs.filter(item => item.isBlocked === options.isBlocked);
        return docs.slice(0, limit);
      }
    } catch (err) {
      console.warn('[SearchLogger] Firestore getRecentSearches notice, using local cache:', err.message);
      firestoreAvailable = false;
    }
  }

  // Fallback to local history
  if (fs.existsSync(LOCAL_HISTORY_FILE)) {
    try {
      let list = JSON.parse(fs.readFileSync(LOCAL_HISTORY_FILE, 'utf8'));
      if (options.status) list = list.filter(item => item.status === options.status);
      if (typeof options.isBlocked === 'boolean') list = list.filter(item => item.isBlocked === options.isBlocked);
      return list.slice(0, limit).map(item => ({
        id: item.id,
        query: item.query,
        status: item.status || (item.isBlocked ? 'BLOCKED' : 'SUCCESS'),
        isBlocked: Boolean(item.isBlocked),
        blockReason: item.blockReason || null,
        errorMessage: item.errorMessage || null,
        totalFound: item.totalFound || 0,
        returnedCount: item.returnedCount || 0,
        brandName: item.brandName,
        category: item.category,
        domain: item.profile?.domain || '',
        vectorHits: item.vectorHits || {},
        discoveryErrors: item.discoveryErrors || [],
        collector: item.collector || 'unknown',
        latencyMs: item.latencyMs || 0,
        topResultsSummary: item.topResultsSummary || [],
        timestamp: item.timestamp,
      }));
    } catch (e) {}
  }

  return [];
}

/**
 * Retrieve high-level search diagnostics & metrics
 */
async function getSearchDiagnostics(limit = 50) {
  const recent = await getRecentSearches(limit);
  const totalSearches = recent.length;
  const blockedCount = recent.filter(r => r.isBlocked || r.status === 'BLOCKED').length;
  const successCount = recent.filter(r => r.status === 'SUCCESS' && !r.isBlocked).length;
  const errorCount = recent.filter(r => r.status === 'ERROR').length;
  const lastBlocked = recent.find(r => r.isBlocked || r.status === 'BLOCKED');
  const lastSearch = recent[0] || null;

  return {
    summary: {
      totalLogged: totalSearches,
      successCount,
      blockedCount,
      errorCount,
      blockedRate: totalSearches ? `${Math.round((blockedCount / totalSearches) * 100)}%` : '0%',
      lastSearchAt: lastSearch?.timestamp || null,
      lastBlockedAt: lastBlocked?.timestamp || null,
      lastBlockReason: lastBlocked?.blockReason || null,
      activeCollector: process.env.BROWSERLESS_TOKEN ? 'managed-browserless'
        : process.env.BROWSER_WS_ENDPOINT ? 'managed-playwright' : 'headless-chromium',
      environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
    },
    recentSearches: recent,
  };
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
  getSearchDiagnostics,
  getSearchSession,
};
