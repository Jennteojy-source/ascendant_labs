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

const { profilePDP } = require('./lib/pdp_profiler');
const { expandQueryWithAI } = require('./lib/ai_query_expander');
const { findComparables } = require('./lib/comparable_finder');
const { deduplicateAndRankAds, paginateAds } = require('./lib/ad_ranker');
const { rerankAdsWithAI } = require('./lib/ai_reranker');
const { sniffPageMedia, loadCache, getBrowser } = require('./lib/paginated_sniffer');
const { browserConnectionMode } = require('./lib/meta_browser_searcher');
const { getCachedMediaBatch } = require('./lib/firestore_cache');
const { logSearchSession, getRecentSearches, getSearchDiagnostics, getSearchSession } = require('./lib/search_logger');
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

// Global in-memory cache for recent searches: query -> rankedAds
const searchCache = new Map();

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
      const body = await readJsonBody(req);
      const {
        input,
        countries = ['US', 'GB', 'CA', 'AU'],
        status = 'ACTIVE',
        mediaType = 'ALL',
        page = 1,
        pageSize = 10,
        useCache = true,
      } = body;

      if (!input) {
        return sendJson(res, 400, { error: 'Missing "input" parameter' });
      }

      const trimmedInput = (input || '').trim();
      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
      const userAgent = req.headers['user-agent'];
      const searchParams = { countries, status, mediaType, page, pageSize };
      const cacheKey = `${trimmedInput}::${countries.sort().join(',')}::${status}::${mediaType}`;
      let rankedAds = null;
      let queryProfile = null;
      let searchRes = null;

      try {
        // Check in-memory query cache
        if (useCache && searchCache.has(cacheKey)) {
          const cached = searchCache.get(cacheKey);
          rankedAds = cached.rankedAds;
          queryProfile = cached.queryProfile;
        } else {
          // ─── Stage 1: AI Query Expansion ───────────────────────────
          queryProfile = await expandQueryWithAI(trimmedInput);

          const searchVectors = queryProfile.searchVectors;
          const targetBrand = queryProfile.brandName;
          const coreKeywords = [queryProfile.coreProduct, ...(queryProfile.competitors || [])];

          logger.info('Stage 1 — AI Query Expansion complete', {
            input: trimmedInput,
            brandName: targetBrand,
            vectorCount: searchVectors.length,
            source: queryProfile.source,
          });

          // ─── Stage 2: Agentic Facebook Ads Library Search ─────────
          searchRes = await findComparables({
            vectors: searchVectors,
            countries,
            status,
            mediaType,
            limitPerVector: 50,
            enableAgenticLoop: false,
          });

          logger.info('Stage 2 — Agentic Ads Library search complete', {
            totalRawAds: searchRes.totalRawAds,
            discoveredCompetitors: searchRes.discoveredCompetitors,
          });

          // ─── Stage 3: AI Ranking & Filtering ──────────────────────
          rankedAds = deduplicateAndRankAds(searchRes.ads, {
            countries,
            targetBrand,
            coreKeywords,
            targetDomain: '',
          });

          const evalProfile = {
            brandName: targetBrand,
            category: queryProfile.category || 'Direct Response Offer',
            coreProduct: queryProfile.coreProduct || targetBrand,
            primaryPainPoints: queryProfile.painPoints || [],
            productKeywords: queryProfile.productKeywords || [targetBrand],
          };

          rankedAds = await rerankAdsWithAI(rankedAds, evalProfile);

          logger.info('Stage 3 — AI ranking complete', {
            input: trimmedInput,
            targetBrand,
            totalAdsFound: rankedAds.length,
            activeCount: rankedAds.filter(a => a.stats.isActive).length,
          });

          searchCache.set(cacheKey, { rankedAds, queryProfile, timestamp: Date.now() });
        }

        // ─── Stage 4: Deterministic Rendering (Hydrate + Paginate) ──
        const allAdIds = (rankedAds || []).map(a => String(a.id));
        const mediaCache = await getCachedMediaBatch(allAdIds);
        const uniqueVisualAds = [];

        for (const item of rankedAds) {
          if (mediaCache[item.id]) {
            item.media = mediaCache[item.id];
            if (item.media.destinationUrl) {
              item.destinationUrl = item.media.destinationUrl;
              try {
                item.displayDomain = new URL(item.media.destinationUrl).hostname.replace(/^www\./, '');
              } catch (e) {}
            }
            if (item.media.ctaText) {
              item.ctaText = item.media.ctaText;
            }
          }
          uniqueVisualAds.push(item);
        }

        // Resolve media for top uncached Page 1 ads so search response arrives pre-hydrated with creatives
        const topAdsToPrewarm = uniqueVisualAds
          .slice(0, 4)
          .filter(a => !a.media?.videoUrl && !a.media?.thumbnailUrl);

        if (topAdsToPrewarm.length > 0) {
          try {
            const resolvedMedia = await Promise.race([
              sniffPageMedia(topAdsToPrewarm),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Prewarm timeout')), 3500)),
            ]);
            if (resolvedMedia) {
              for (const [adId, media] of Object.entries(resolvedMedia)) {
                const matchedAd = uniqueVisualAds.find(a => String(a.id) === String(adId));
                if (matchedAd && media && media.mediaType !== 'unknown') {
                  matchedAd.media = media;
                  if (media.destinationUrl) {
                    matchedAd.destinationUrl = media.destinationUrl;
                    try {
                      matchedAd.displayDomain = new URL(media.destinationUrl).hostname.replace(/^www\./, '');
                    } catch (e) {}
                  }
                  if (media.ctaText) matchedAd.ctaText = media.ctaText;
                }
              }
            }
          } catch (e) {
            // Soft timeout, client sniffer completes it smoothly
          }
        }

        // Paginate
        const paginated = paginateAds(uniqueVisualAds, page, pageSize);

        const activeCount = rankedAds.filter(a => a.stats.isActive).length;
        const highScaleCount = rankedAds.filter(a => a.stats.scaleTier.includes('High Scale')).length;
        const officialBrandCount = rankedAds.filter(a => a.ranking?.relationship === 'OFFICIAL_BRAND' || a.ranking?.relevanceType === 'OFFICIAL_BRAND').length;
        const affiliatePartnerCount = rankedAds.filter(a => a.ranking?.relationship === 'AFFILIATE_PARTNER' || a.ranking?.relevanceType === 'AFFILIATE_PARTNER').length;
        const reviewEditorialCount = rankedAds.filter(a => a.ranking?.relationship === 'REVIEW_EDITORIAL' || a.ranking?.relevanceType === 'REVIEW_EDITORIAL').length;

        // Log query and results to Firestore search_history table asynchronously
        logSearchSession({
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
        }).catch(err => console.warn('[Server] Log search notice:', err.message));

        return sendJson(res, 200, {
          queryProfile,
          paginated,
          stats: {
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
          query: trimmedInput,
          status: searchStatus,
          isBlocked,
          blockReason,
          error: err.message,
        });

        // Always log blocked or failed searches to Firestore!
        await logSearchSession({
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
        }).catch(logErr => console.warn('[Server] Log failed search notice:', logErr.message));

        return sendJson(res, isBlocked ? 403 : 500, {
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
        batchSize: ads.length,
        adIds: ads.map(a => a.id),
      });

      // Sniff media for up to 10 ads on the active page
      const mediaMap = await sniffPageMedia(ads, { forceRefresh: body.forceRefresh === true });

      logger.info('Media sniffing batch completed', {
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
        cachedQueriesCount: searchCache.size,
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

  // Avoid opening billable managed-browser sessions until a search needs one.
  if (browserConnectionMode() === 'local-chromium') {
    getBrowser()
      .then(() => logger.info('Headless Chromium pre-warmed and ready for media sniffing'))
      .catch((err) => logger.warn('Chromium pre-warm notice:', { error: err.message }));
  }
});
