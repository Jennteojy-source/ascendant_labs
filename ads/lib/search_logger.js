/**
 * Persistent Search History & Results Logger (Firestore + Local JSON Fallback)
 * Ascendant Labs / Intelligence Logging & Replay Engine
 * 
 * Logs all search queries and their ranked ad results to Firestore table 'search_history'.
 * Allows historical review, analytics, and instant zero-latency replays.
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');

const COLLECTION_NAME = 'search_history';
const ADS_COLLECTION_NAME = 'ad_library_ads';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';
const memoryHistory = [];

let firestoreInstance = null;
let firestoreAvailable = null;

function getFirestore() {
  if (process.env.DISABLE_FIRESTORE === '1' || process.env.NODE_ENV === 'test') {
    return null;
  }
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
      description: ad.copy?.description || '',
    },
    stats: {
      flightDays: Number(ad.stats?.flightDays || 1),
      isActive: ad.stats?.isActive !== false,
      startDate: ad.stats?.startDate || null,
      endDate: ad.stats?.endDate || null,
      scaleTier: ad.stats?.scaleTier || 'Active',
      reachEst: ad.stats?.reachEst || 'Standard',
      languages: Array.isArray(ad.stats?.languages) ? ad.stats.languages : [],
      countries: Array.isArray(ad.stats?.countries) ? ad.stats.countries : [],
      countryBasis: ['reached', 'targeted', 'listed'].includes(ad.stats?.countryBasis)
        ? ad.stats.countryBasis : 'unknown',
      reachedCountries: Array.isArray(ad.stats?.reachedCountries) ? ad.stats.reachedCountries : [],
      targetedCountries: Array.isArray(ad.stats?.targetedCountries) ? ad.stats.targetedCountries : [],
      excludedCountries: Array.isArray(ad.stats?.excludedCountries) ? ad.stats.excludedCountries : [],
      listedCountries: Array.isArray(ad.stats?.listedCountries) ? ad.stats.listedCountries : [],
      platforms: Array.isArray(ad.stats?.platforms) ? ad.stats.platforms : [],
    },
    media: {
      schemaVersion: 2,
      status: ad.media?.status || 'ready',
      mediaType: ad.media?.mediaType || (ad.media?.videoUrl ? 'video' : 'image'),
      thumbnailUrl: ad.media?.thumbnailUrl || null,
      videoUrl: ad.media?.videoUrl || null,
      creatives: Array.isArray(ad.media?.creatives) && ad.media.creatives.length > 0
        ? ad.media.creatives.map(creative => ({
            mediaType: creative.mediaType || (creative.videoUrl ? 'video' : 'image'),
            thumbnailUrl: creative.thumbnailUrl || null,
            videoUrl: creative.videoUrl || null,
          }))
        : (ad.media?.thumbnailUrl || ad.media?.videoUrl ? [{
            mediaType: ad.media?.mediaType || (ad.media?.videoUrl ? 'video' : 'image'),
            thumbnailUrl: ad.media?.thumbnailUrl || null,
            videoUrl: ad.media?.videoUrl || null,
          }] : []),
      destinationUrl: ad.media?.destinationUrl || ad.destinationUrl || null,
      ctaText: ad.media?.ctaText || ad.ctaText || null,
      // These values identify the immutable GCS object backing /api/media URLs.
      assetObjectPaths: storedAssetPaths(ad.media, String(ad.id || '')),
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

function storedAssetPaths(media, adId) {
  const urls = [media?.thumbnailUrl, media?.videoUrl, ...(media?.creatives || []).flatMap(item => [item.thumbnailUrl, item.videoUrl])];
  const expression = new RegExp(`^/api/media/${adId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([a-f0-9]{64}\\.(?:jpg|png|webp|gif|mp4|webm|mov))$`);
  return [...new Set(urls.filter(Boolean).map(url => {
    const match = expression.exec(String(url));
    return match ? `ad-media/${adId}/${match[1]}` : null;
  }).filter(Boolean))];
}

async function saveCanonicalAds(db, ads) {
  const validAds = ads.filter(ad => /^\d{1,40}$/.test(ad.id));
  for (let start = 0; start < validAds.length; start += 450) {
    const batch = db.batch();
    for (const ad of validAds.slice(start, start + 450)) {
      batch.set(db.collection(ADS_COLLECTION_NAME).doc(ad.id), {
        ...ad,
        adLibraryId: ad.id,
        storage: { bucket: process.env.MEDIA_STORAGE_BUCKET || `${PROJECT_ID}-ad-media`, assetObjectPaths: ad.media.assetObjectPaths || [] },
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
}

async function upsertCanonicalAds(ads = []) {
  const db = getFirestore();
  if (!db || firestoreAvailable === false) return false;
  try {
    await saveCanonicalAds(db, (ads || []).map(sanitizeAdForStorage).filter(Boolean));
    firestoreAvailable = true;
    return true;
  } catch (err) {
    console.warn('[SearchLogger] Canonical ad write notice:', err.message);
    firestoreAvailable = false;
    return false;
  }
}

async function upsertCanonicalMedia(ads = []) {
  const db = getFirestore();
  if (!db || firestoreAvailable === false) return false;
  try {
    const batch = db.batch();
    for (const ad of ads.filter(item => /^\d{1,40}$/.test(String(item?.id || '')))) {
      const id = String(ad.id);
      const media = sanitizeAdForStorage({ id, media: ad.media }).media;
      batch.set(db.collection(ADS_COLLECTION_NAME).doc(id), {
        media,
        storage: { bucket: process.env.MEDIA_STORAGE_BUCKET || `${PROJECT_ID}-ad-media`,
          assetObjectPaths: media.assetObjectPaths || [] },
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    firestoreAvailable = true;
    return true;
  } catch (err) {
    console.warn('[SearchLogger] Canonical media write notice:', err.message);
    firestoreAvailable = false;
    return false;
  }
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
  const canonicalAds = (ads || []).map(sanitizeAdForStorage).filter(Boolean);
  // Keep replay payload bounded; the session still references every canonical ad.
  const sanitizedAds = canonicalAds.slice(0, 80);

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
      intentType: profile.intentType || 'NAMED_OFFER',
      aliases: profile.aliases || [],
      groundingSources: profile.groundingSources || [],
      suggestedVectors: profile.suggestedVectors || [],
    } : null,
    topResultsSummary,
    resultAdIds: canonicalAds.map(ad => ad.id),
    results: sanitizedAds,
    metadata: {
      collector: collector || ((process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_API) ? 'managed-browserless'
        : process.env.BROWSER_WS_ENDPOINT ? 'managed-playwright' : 'headless-chromium'),
      environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
      latencyMs: Number(latencyMs) || 0,
      clientIp: clientIp || null,
      userAgent: userAgent ? userAgent.substring(0, 200) : null,
      loggedAt: new Date().toISOString(),
    },
  };

  // 1. Save to in-memory history
  memoryHistory.unshift({
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
  if (memoryHistory.length > 100) memoryHistory.length = 100;

  // 2. Save to Google Cloud Firestore
  const db = getFirestore();
  if (db && firestoreAvailable !== false) {
    try {
      const docRef = db.collection(COLLECTION_NAME).doc(id);
      await saveCanonicalAds(db, canonicalAds);
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

  // Fallback to in-memory history
  let list = [...memoryHistory];
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
      activeCollector: process.env.BROWSERLESS_PRIMARY === '1' && (process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_API)
        ? 'managed-browserless'
        : process.env.BROWSER_WS_ENDPOINT
          ? 'managed-playwright'
          : (process.env.BROWSERLESS_TOKEN || process.env.BROWSERLESS_API)
            ? 'chromium (browserless fallback ready)'
            : 'chromium',
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

  // Fallback to in-memory history
  const found = memoryHistory.find(item => item.id === id);
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

  return null;
}

module.exports = {
  logSearchSession,
  getRecentSearches,
  getSearchDiagnostics,
  getSearchSession,
  sanitizeAdForStorage,
  storedAssetPaths,
  upsertCanonicalAds,
  upsertCanonicalMedia,
};
