/**
 * Agentic Meta Ad Search API & Web Server
 * Ascendant Labs
 * 
 * High-performance, zero-dependency Node.js HTTP server.
 * Serves the modern visual search UI on port 3030 and exposes
 * REST endpoints for PDP profiling, multi-vector search, and on-demand sniffing.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

require('./lib/local_env').loadLocalEnv();

const { profilePDP } = require('./lib/pdp_profiler');
const { expandQueryWithAI } = require('./lib/ai_query_expander');
const { decideNextSearch } = require('./lib/ai_retrieval_agent');
const { findComparables, queryMetaArchive } = require('./lib/comparable_finder');
const { deduplicateAndRankAds, paginateAds } = require('./lib/ad_ranker');
const { rerankAdsWithAI, isSearchMatch } = require('./lib/ai_reranker');
const { matchesProductIdentity } = require('./lib/product_identity');
const { sniffPageMedia, loadCache } = require('./lib/paginated_sniffer');
const { browserConnectionMode, getSearchBrowser } = require('./lib/meta_browser_searcher');
const { getCachedMediaBatch, saveMediaBatch } = require('./lib/firestore_cache');
const { persistMediaBatch, storageStatus, streamStoredMedia } = require('./lib/media_storage');
const { logSearchSession, createSearchId, recordSearchEvent, getRecentSearches, getSearchDiagnostics,
  getSearchSession, upsertCanonicalMedia } = require('./lib/search_logger');
const { buildSearchEvaluation } = require('./lib/search_evaluation');
const logger = require('./lib/gcp_logger');

const PORT = process.env.PORT || 3050;
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const WEB_DIR = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.resolve(__dirname, 'web');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  stream.pipe(res);
}

function attachMedia(item, media) {
  if (!item || !media || media.mediaType === 'unknown') return;
  item.media = media;
  if (media.destinationUrl) {
    item.destinationUrl = media.destinationUrl;
    try { item.displayDomain = new URL(media.destinationUrl).hostname.replace(/^www\./, ''); } catch { /* Keep existing label. */ }
  }
  if (media.ctaText) item.ctaText = media.ctaText;
}

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Structured GCP HTTP request logging
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    logger.logHttp(req, res.statusCode, durationMs);
  });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  try {
    const storedMediaMatch = /^\/api\/media\/(\d{1,40})\/([a-f0-9]{64}\.(?:jpg|png|webp|gif|mp4|webm|mov))$/.exec(pathname);
    if (req.method === 'GET' && storedMediaMatch) {
      const streamed = await streamStoredMedia(req, res, storedMediaMatch[1], storedMediaMatch[2]);
      if (!streamed) return sendJson(res, 404, { error: 'Media not found' });
      return;
    }

    // 1. Static Web UI Routes
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return serveStatic(res, path.join(WEB_DIR, 'index.html'), 'text/html');
    }
    if (req.method === 'GET' && pathname === '/styles.css') {
      return serveStatic(res, path.join(WEB_DIR, 'styles.css'), 'text/css');
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      return serveStatic(res, path.join(WEB_DIR, 'app.js'), 'application/javascript');
    }
    if (req.method === 'GET' && pathname === '/media.js') {
      return serveStatic(res, path.join(WEB_DIR, 'media.js'), 'application/javascript');
    }
    if (req.method === 'GET' && pathname.startsWith('/assets/logos/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(WEB_DIR, 'assets/logos', fileName);
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      return serveStatic(res, filePath, mimeTypes[ext] || 'application/octet-stream');
    }
    if (req.method === 'GET' && (pathname === '/favicon.svg' || pathname === '/favicon.ico')) {
      return serveStatic(res, path.join(WEB_DIR, 'assets/logos/favicon.svg'), 'image/svg+xml');
    }

    // 2. API Route: Analyze PDP
    if (req.method === 'POST' && pathname === '/api/analyze-pdp') {
      const body = await readJsonBody(req);
      if (!body.url) return sendJson(res, 400, { error: 'Missing "url" parameter' });
      const profile = await profilePDP(body.url);
      return sendJson(res, 200, { profile });
    }

    // 3. API Route: Multi-Vector Comparable Search
    if (req.method === 'POST' && pathname === '/api/search') {
      const searchStartTime = Date.now();
      const searchId = createSearchId();
      const body = await readJsonBody(req);
      const {
        input,
        countries = ['ALL'],
        status = 'ACTIVE',
        mediaType = 'ALL',
        page = 1,
        pageSize = 10,
      } = body;

      if (!input) {
        return sendJson(res, 400, { error: 'Missing "input" parameter' });
      }

      const trimmedInput = (input || '').trim();
      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
      const userAgent = req.headers['user-agent'];
      const searchParams = { countries, status, mediaType, page, pageSize };
      const searchDeadlineMs = searchStartTime + Math.max(30000,
        Math.min(50000, Number(process.env.SEARCH_TOTAL_BUDGET_MS) || 45000));
      let rankedAds = null;
      let queryProfile = null;
      let searchRes = null;
      let deterministicAds = [];
      let rerankedAds = [];
      const pipeline = { startedAt: new Date(searchStartTime).toISOString(), stages: {} };

      try {
        // A submitted search is always live. Media has its own durable cache,
        // but never reuse a prior query's result set.
        {
          // ─── Stage 1: AI Query Expansion ───────────────────────────
          const expansionStarted = Date.now();
          queryProfile = await expandQueryWithAI(trimmedInput);
          pipeline.stages.queryExpansionMs = Date.now() - expansionStarted;

          const searchVectors = queryProfile.searchVectors;
          const targetBrand = queryProfile.brandName;
          const targetCountry = queryProfile.targetCountry;
          const effectiveCountries = targetCountry ? [targetCountry] : countries;
          const coreKeywords = [queryProfile.coreProduct, ...(queryProfile.competitors || [])];

          logger.info('Stage 1 — AI Query Expansion complete', {
            searchId,
            input: trimmedInput,
            brandName: targetBrand,
            targetCountry: targetCountry || 'ALL',
            vectorCount: searchVectors.length,
            source: queryProfile.source,
          });

          // ─── Stage 2: Agentic Facebook Ads Library Search ─────────
          const discoveryStarted = Date.now();
          searchRes = await findComparables({
            vectors: searchVectors,
            countries: effectiveCountries,
            status,
            mediaType,
            limitPerVector: 25,
            // Goal-driven retrieval: broaden or pivot only when recall is sparse
            minRecall: Number(process.env.SEARCH_MIN_RECALL) || 5,
            maxQueries: Number(process.env.SEARCH_MAX_RETRIEVAL_QUERIES) || 5,
            deadlineMs: Math.max(5000, Math.min(
              Number(process.env.SEARCH_RETRIEVAL_DEADLINE_MS) || 38000,
              searchDeadlineMs - Date.now() - 3000)),
            nextQueries: context => decideNextSearch({ input: trimmedInput, profile: queryProfile, ...context }),
            isRelevantCandidate: ad => matchesProductIdentity(ad, queryProfile, trimmedInput),
            enableAgenticLoop: false,
          });

          pipeline.stages.discoveryMs = Date.now() - discoveryStarted;

          logger.info('Stage 2 — Agentic Ads Library search complete', {
            searchId,
            totalRawAds: searchRes.totalRawAds,
            discoveredCompetitors: searchRes.discoveredCompetitors,
            discoveryMs: pipeline.stages.discoveryMs,
            vectorHits: searchRes.vectorHits,
            deadlineReached: searchRes.deadlineReached,
          });

          // ─── Stage 3: AI Ranking & Filtering ──────────────────────
          const rankingStarted = Date.now();
          rankedAds = deduplicateAndRankAds(searchRes.ads, {
            countries,
            targetBrand,
            coreKeywords,
            targetDomain: '',
            searchQuery: trimmedInput,
          });
          deterministicAds = rankedAds;

          const evalProfile = {
            brandName: targetBrand,
            intentType: queryProfile.intentType || 'NAMED_OFFER',
            aliases: queryProfile.aliases || [],
            groundingSources: queryProfile.groundingSources || [],
            category: queryProfile.category || 'Direct Response Offer',
            coreProduct: queryProfile.coreProduct || targetBrand,
            primaryPainPoints: queryProfile.painPoints || [],
            productKeywords: queryProfile.productKeywords || [targetBrand],
          };

          rankedAds = await rerankAdsWithAI(rankedAds, evalProfile);
          rerankedAds = rankedAds;
          rankedAds = rankedAds.filter(ad => isSearchMatch(ad, evalProfile));
          pipeline.stages.rankingMs = Date.now() - rankingStarted;

          logger.info('Stage 3 — AI ranking complete', {
            searchId,
            input: trimmedInput,
            targetBrand,
            totalAdsFound: rankedAds.length,
            activeCount: rankedAds.filter(a => a.stats.isActive).length,
          });

        }

        // ─── Stage 4: Resolve + persist render-ready media ──────────
        const mediaStarted = Date.now();
        const allAdIds = (rankedAds || []).map(a => String(a.id));
        const mediaCache = await getCachedMediaBatch(allAdIds);
        const uniqueVisualAds = [];

        for (const item of rankedAds) {
          if (mediaCache[item.id]) attachMedia(item, mediaCache[item.id]);
          uniqueVisualAds.push(item);
        }

        // Return metadata immediately. Only cards that enter the viewport request
        // media, which eliminates N remote-browser snapshot sessions per search.
        const readyAds = uniqueVisualAds.filter(ad => ad.media?.status === 'ready');
        pipeline.stages.mediaMs = Date.now() - mediaStarted;
        pipeline.media = {
          requested: 0,
          ready: readyAds.filter(ad => ad.media?.status === 'ready').length,
          durable: readyAds.filter(ad => ['ready', 'partial'].includes(ad.media?.storageStatus)).length,
        };

        // Paginate
        const paginated = paginateAds(uniqueVisualAds, page, pageSize);

        const activeCount = rankedAds.filter(a => a.stats.isActive).length;
        const highScaleCount = rankedAds.filter(a => a.stats.scaleTier.includes('High Scale')).length;
        const officialBrandCount = rankedAds.filter(a => a.ranking?.relationship === 'OFFICIAL_BRAND' || a.ranking?.relevanceType === 'OFFICIAL_BRAND').length;
        const affiliatePartnerCount = rankedAds.filter(a => a.ranking?.relationship === 'AFFILIATE_PARTNER' || a.ranking?.relevanceType === 'AFFILIATE_PARTNER').length;
        const reviewEditorialCount = rankedAds.filter(a => a.ranking?.relationship === 'REVIEW_EDITORIAL' || a.ranking?.relevanceType === 'REVIEW_EDITORIAL').length;

        // Await this: every completed live search must be durably recorded.
        const evaluation = buildSearchEvaluation({
          rawAds: searchRes?.ads || [], deterministicAds, rerankedAds,
          returnedAds: uniqueVisualAds, retrievalAttempts: searchRes?.retrievalAttempts || [],
          pipeline: { ...pipeline, totalMs: Date.now() - searchStartTime }, profile: queryProfile,
        });
        await logSearchSession({
          id: searchId,
          query: input,
          status: searchRes?.hasPartialBlocks ? 'PARTIAL' : 'SUCCESS',
          isBlocked: false,
          searchType: 'ai_expanded',
          searchParams,
          profile: queryProfile,
          ads: uniqueVisualAds,
          totalFound: rankedAds.length,
          returnedCount: uniqueVisualAds.length,
          vectorHits: searchRes?.vectorHits || {},
          discoveryErrors: searchRes?.discoveryErrors || [],
          latencyMs: Date.now() - searchStartTime,
          clientIp,
          userAgent,
          evaluation,
        }).catch(err => console.warn('[Server] Log search notice:', err.message));

        return sendJson(res, 200, {
          searchId,
          queryProfile,
          paginated,
          pipeline: { ...pipeline, totalMs: Date.now() - searchStartTime },
          stats: {
            sourceAdsFound: searchRes?.totalRawAds || 0,
            totalUniqueCreatives: rankedAds.length,
            activeCount,
            inactiveCount: rankedAds.length - activeCount,
            highScaleCount,
            officialBrandCount,
            affiliatePartnerCount,
            reviewEditorialCount,
          },
        });
      } catch (err) {
        const isBlocked = Boolean(err.isBlocked || /blocked/i.test(err.message));
        const blockReason = err.blockReason || (isBlocked ? 'Meta blocked the browser session' : null);
        const searchStatus = isBlocked ? 'BLOCKED' : 'ERROR';

        logger.error('Search request failed or blocked', {
          searchId,
          query: trimmedInput,
          status: searchStatus,
          isBlocked,
          blockReason,
          error: err.message,
        });

        // Always log blocked or failed searches to Firestore!
        await logSearchSession({
          id: searchId,
          query: input,
          status: searchStatus,
          isBlocked,
          blockReason,
          errorMessage: err.message,
          searchType: 'ai_expanded',
          searchParams,
          profile: queryProfile,
          ads: [],
          totalFound: 0,
          returnedCount: 0,
          vectorHits: err.vectorHits || searchRes?.vectorHits || {},
          discoveryErrors: err.discoveryErrors || searchRes?.discoveryErrors || [],
          latencyMs: Date.now() - searchStartTime,
          clientIp,
          userAgent,
          evaluation: buildSearchEvaluation({ rawAds: searchRes?.ads || [], deterministicAds,
            rerankedAds, returnedAds: [], retrievalAttempts: err.retrievalAttempts || searchRes?.retrievalAttempts || [],
            pipeline: { ...pipeline, totalMs: Date.now() - searchStartTime }, profile: queryProfile }),
        }).catch(logErr => console.warn('[Server] Log failed search notice:', logErr.message));

        return sendJson(res, isBlocked ? 403 : 500, {
          searchId,
          error: isBlocked
            ? 'Meta blocked the browser session. Configure the managed Browserless connection.'
            : `Search failed: ${err.message}`,
          status: searchStatus,
          isBlocked,
          blockReason,
        });
      }
    }

    // 4. API Route: Search History (Review past queries)
    if (req.method === 'GET' && (pathname === '/api/search-history' || pathname === '/api/history')) {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '30', 10);
      const statusFilter = parsedUrl.searchParams.get('status') || undefined;
      const isBlockedParam = parsedUrl.searchParams.get('isBlocked');
      const isBlockedFilter = isBlockedParam !== null ? isBlockedParam === 'true' : undefined;
      const history = await getRecentSearches(limit, { status: statusFilter, isBlocked: isBlockedFilter });
      return sendJson(res, 200, { history });
    }

    // 5. API Route: Search Diagnostics (System health, block rate, and recent logs)
    if (req.method === 'GET' && (pathname === '/api/search-diagnostics' || pathname === '/api/diagnostics')) {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
      const diagnostics = await getSearchDiagnostics(limit);
      return sendJson(res, 200, diagnostics);
    }

    // 5. API Route: Replay Search Session (Instant zero-latency replay from Firestore)
    if (req.method === 'GET' && (pathname === '/api/replay-search' || pathname === '/api/replay')) {
      const id = parsedUrl.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'Missing "id" query parameter' });

      const session = await getSearchSession(id);
      if (!session) return sendJson(res, 404, { error: `Search session "${id}" not found` });

      // Hydrate with latest media cache if available
      const results = session.results || [];
      const allAdIds = results.map(a => String(a.id));
      const mediaCache = await getCachedMediaBatch(allAdIds);

      for (const item of results) {
        if (mediaCache[item.id]) {
          item.media = mediaCache[item.id];
          if (item.media.destinationUrl) item.destinationUrl = item.media.destinationUrl;
          if (item.media.ctaText) item.ctaText = item.media.ctaText;
        }
      }

      const paginated = paginateAds(results, 1, 10);
      const activeCount = results.filter(a => a.stats?.isActive).length;
      const highScaleCount = results.filter(a => a.stats?.scaleTier?.includes('High Scale')).length;

      return sendJson(res, 200, {
        isReplay: true,
        id: session.id,
        query: session.query,
        profile: session.profile,
        paginated,
        allAds: results,
        stats: {
          totalUniqueCreatives: results.length,
          activeCount,
          inactiveCount: results.length - activeCount,
          highScaleCount,
          brandAffiliateCount: results.filter(a => a.ranking?.relationship === 'BRAND_AFFILIATE').length,
          competitorCount: results.filter(a => a.ranking?.relationship === 'COMPETITOR').length,
        },
        replayedAt: new Date().toISOString(),
        originalTimestamp: session.metadata?.loggedAt || session.timestamp,
      });
    }

    // Browser outcomes complete the evaluation trail after the search response.
    if (req.method === 'POST' && pathname === '/api/client-event') {
      const origin = req.headers.origin;
      if (origin) {
        let sameOrigin = false;
        try { sameOrigin = new URL(origin).host === req.headers.host; } catch {}
        if (!sameOrigin) return sendJson(res, 403, { error: 'Invalid origin' });
      }
      const body = await readJsonBody(req);
      if (!['asset_loaded', 'asset_failed', 'preview_unavailable', 'media_request_failed']
        .includes(body.event?.type)) return sendJson(res, 400, { error: 'Invalid event type' });
      const saved = await recordSearchEvent(body.searchId, { ...body.event, reportedBy: 'browser' });
      return sendJson(res, saved ? 200 : 400, saved ? { recorded: true } : { error: 'Invalid event' });
    }

    // 4. API Route: On-Demand Paginated Media Sniffer
    if (req.method === 'POST' && pathname === '/api/sniff-page') {
      const body = await readJsonBody(req);
      const ads = body.ads || [];
      if (!Array.isArray(ads) || ads.length === 0) {
        return sendJson(res, 400, { error: 'Missing or empty "ads" array' });
      }
      if (ads.length > 10 || ads.some(ad => !ad || !/^\d{1,40}$/.test(String(ad.id)))) {
        return sendJson(res, 400, { error: 'Provide up to 10 valid Ad Library IDs' });
      }

      logger.info('Media sniffing batch started', {
        searchId: body.searchId || null,
        batchSize: ads.length,
        adIds: ads.map(a => a.id),
      });

      // Sniff media for up to 10 ads on the active page
      const extractedMedia = await sniffPageMedia(ads, { forceRefresh: body.forceRefresh === true });
      const mediaMap = await persistMediaBatch(extractedMedia);
      await Promise.all(ads.map(ad => {
        const media = mediaMap[String(ad.id)];
        return recordSearchEvent(body.searchId, {
          type: 'media_resolved', reportedBy: 'server', adId: ad.id, mediaStatus: media?.status || 'missing',
          source: media?.source || '', storageStatus: media?.storageStatus || '',
          httpStatus: media?.diagnostic?.httpStatus || null,
          reason: media?.diagnostic?.reason || '',
        });
      }));
      await saveMediaBatch(mediaMap);
      // A later-page preview is just as durable as a first-page preview: update
      // its canonical Firestore ad record after the GCS object is persisted.
      await upsertCanonicalMedia(ads.map(ad => ({ id: ad.id, media: mediaMap[String(ad.id)] || ad.media })));

      logger.info('Media sniffing batch completed', {
        searchId: body.searchId || null,
        resolvedCount: Object.keys(mediaMap).length,
      });

      return sendJson(res, 200, { mediaMap });
    }

    // 5. API Route: Health & Cache Info
    if (req.method === 'GET' && pathname === '/api/health') {
      const mediaCache = loadCache();
      return sendJson(res, 200, {
        status: 'OK',
        collector: 'playwright-public-library',
        browserMode: browserConnectionMode(),
        tokenRequired: false,
        uptimeSec: Math.round(process.uptime()),
        cachedMediaCount: Object.keys(mediaCache).length,
        cachedQueriesCount: 0,
        mediaStorage: storageStatus(),
      });
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err) {
    logger.error('Server error handling request', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
    sendJson(res, 500, { error: 'Internal server error: ' + err.message });
  }
});

async function startServer() {
  // Cloud Run grants startup CPU before readiness. Launch Chromium in that
  // window so the warm min-instance can serve its first search immediately.
  if (process.env.K_SERVICE && browserConnectionMode() === 'local-chromium') {
    const warmStartedAt = Date.now();
    try {
      await getSearchBrowser();
      logger.info('Headless Chromium warm before readiness', { durationMs: Date.now() - warmStartedAt });
    } catch (error) {
      logger.warn('Chromium startup warm-up failed; search will retry launch', {
        durationMs: Date.now() - warmStartedAt, error: String(error.message || '').slice(0, 300),
      });
    }
  }
  server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Ascendant Labs Meta Ad Intelligence Server is listening on 0.0.0.0:${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    service: process.env.K_SERVICE || 'local',
  });
  console.log(`\n========================================================================`);
  console.log(` 🚀 ASCENDANT LABS — META AD INTELLIGENCE ENGINE IS LIVE!`);
  console.log(` URL:     http://localhost:${PORT}`);
  console.log(` Web UI:  ${path.join(WEB_DIR, 'index.html')}`);
  console.log(`========================================================================\n`);

  // Outside Cloud Run, preserve fast local startup and warm in the background.
  if (!process.env.K_SERVICE && browserConnectionMode() === 'local-chromium') {
    getSearchBrowser()
      .then(() => logger.info('Headless Chromium warm and ready'))
      .catch(error => logger.warn('Chromium background warm-up failed; search will retry launch', { error: error.message }));
  }
  });
}

startServer();
