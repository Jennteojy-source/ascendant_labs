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
const { findComparables } = require('./lib/comparable_finder');
const { deduplicateAndRankAds, paginateAds } = require('./lib/ad_ranker');
const { sniffPageMedia, loadCache } = require('./lib/paginated_sniffer');
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
      const body = await readJsonBody(req);
      const {
        input,
        searchType = 'auto',
        vectors,
        countries = ['US', 'GB', 'CA', 'AU'],
        status = 'ACTIVE',
        mediaType = 'ALL',
        page = 1,
        pageSize = 10,
        useCache = true,
      } = body;

      if (!input && (!vectors || vectors.length === 0)) {
        return sendJson(res, 400, { error: 'Missing "input" or "vectors" parameter' });
      }

      const cacheKey = `${input || 'vectors'}::${countries.sort().join(',')}::${status}::${mediaType}`;
      let rankedAds = null;
      let profile = null;

      // Check in-memory query cache
      if (useCache && searchCache.has(cacheKey)) {
        const cached = searchCache.get(cacheKey);
        rankedAds = cached.rankedAds;
        profile = cached.profile;
      } else {
        const trimmedInput = (input || '').trim();
        const isUrl = /^https?:\/\//i.test(trimmedInput) || (trimmedInput && (trimmedInput.includes('.com') || trimmedInput.includes('.io') || trimmedInput.includes('.co') || trimmedInput.includes('.net') || trimmedInput.includes('.org') || trimmedInput.includes('/')));

        let searchVectors = vectors ? [...vectors] : [];
        let targetBrand = '';
        let coreKeywords = [];
        let targetDomain = '';

        if ((searchType === 'url' || isUrl) && searchVectors.length === 0) {
          profile = await profilePDP(trimmedInput);
          searchVectors = profile.suggestedVectors;
          targetBrand = profile.brandName;
          coreKeywords = [profile.coreProduct, ...(profile.searchKeywords || [])];
          targetDomain = profile.domain;
        } else if (searchVectors.length === 0) {
          // Brand / Advertiser or Product Keywords search
          const words = trimmedInput.split(/\s+/).filter(w => w.length > 2);
          const isMultiWordKeywords = words.length >= 2 && !/vpn|nord|derila|apple|nike/i.test(trimmedInput);

          if (searchType === 'brand' || (!isMultiWordKeywords && words.length <= 2)) {
            // Treat as Brand / Advertiser name
            targetBrand = trimmedInput;
            coreKeywords = [trimmedInput];
            searchVectors = [
              { type: 'BRAND', query: trimmedInput },
              { type: 'PRODUCT', query: trimmedInput },
            ];
          } else {
            // Treat as Product Keywords
            targetBrand = '';
            coreKeywords = words;
            searchVectors = [
              { type: 'PRODUCT', query: trimmedInput },
              { type: 'CATEGORY', query: words.slice(0, 2).join(' ') },
            ];
          }
        }

        const searchRes = await findComparables({
          vectors: searchVectors,
          countries,
          status,
          mediaType,
          limitPerVector: 25,
          enableAgenticLoop: true,
        });

        rankedAds = deduplicateAndRankAds(searchRes.ads, {
          countries,
          targetBrand,
          coreKeywords,
          targetDomain,
        });
        logger.info('Competitor search request processed', {
          input: trimmedInput,
          isUrl,
          targetBrand,
          totalAdsFound: rankedAds.length,
          activeCount: rankedAds.filter(a => a.stats.isActive).length,
        });

        searchCache.set(cacheKey, { rankedAds, profile, timestamp: Date.now() });
      }

      // Paginate
      const paginated = paginateAds(rankedAds, page, pageSize);

      // Hydrate with any media already cached in disk/memory
      const mediaCache = loadCache();
      for (const item of paginated.items) {
        if (mediaCache[item.id]) {
          item.media = mediaCache[item.id];
        }
      }

      const activeCount = rankedAds.filter(a => a.stats.isActive).length;
      const highScaleCount = rankedAds.filter(a => a.stats.scaleTier.includes('High Scale')).length;

      return sendJson(res, 200, {
        profile,
        paginated,
        stats: {
          totalUniqueCreatives: rankedAds.length,
          activeCount,
          inactiveCount: rankedAds.length - activeCount,
          highScaleCount,
        },
      });
    }

    // 4. API Route: On-Demand Paginated Media Sniffer
    if (req.method === 'POST' && pathname === '/api/sniff-page') {
      const body = await readJsonBody(req);
      const ads = body.ads || [];
      if (!Array.isArray(ads) || ads.length === 0) {
        return sendJson(res, 400, { error: 'Missing or empty "ads" array' });
      }

      logger.info('Media sniffing batch started', {
        batchSize: ads.length,
        adIds: ads.map(a => a.id),
      });

      // Sniff media for up to 10 ads on the active page
      const mediaMap = await sniffPageMedia(ads.slice(0, 10));

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
});
