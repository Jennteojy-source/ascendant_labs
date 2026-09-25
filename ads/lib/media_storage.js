/** Durable, bounded media ingestion for ranked Meta ad creatives. */
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');
const { mediaUrl } = require('./media_resolver');
const logger = require('./gcp_logger');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'ascendant-labs-45812';
const BUCKET_NAME = process.env.MEDIA_STORAGE_BUCKET || `${PROJECT_ID}-ad-media`;
const IMAGE_LIMIT = Math.max(1024, Number(process.env.MEDIA_MAX_IMAGE_BYTES) || 12 * 1024 * 1024);
const VIDEO_LIMIT = Math.max(1024, Number(process.env.MEDIA_MAX_VIDEO_BYTES) || 50 * 1024 * 1024);
const MAX_CREATIVES = Math.max(1, Math.min(10, Number(process.env.MEDIA_MAX_CREATIVES_PER_AD) || 3));
const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.MEDIA_FETCH_TIMEOUT_MS) || 25000);
const CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'],
]);

let storage;
let retryStorageAt = 0;

function getBucket() {
  if (process.env.MEDIA_STORAGE_DISABLED === '1' || Date.now() < retryStorageAt) return null;
  if (!storage) storage = new Storage({ projectId: PROJECT_ID });
  return storage.bucket(BUCKET_NAME);
}

function isStoredMediaUrl(value) {
  return typeof value === 'string' && /^\/api\/media\/\d{1,40}\/[a-f0-9]{64}\.(?:jpg|png|webp|gif|mp4|webm|mov)$/.test(value);
}

function objectName(adId, hash, extension) {
  if (!/^\d{1,40}$/.test(String(adId)) || !/^[a-f0-9]{64}$/.test(hash)
      || !/^(?:jpg|png|webp|gif|mp4|webm|mov)$/.test(extension)) return null;
  return `ad-media/${adId}/${hash}.${extension}`;
}

function publicMediaUrl(name) {
  const match = /^ad-media\/(\d{1,40})\/([a-f0-9]{64}\.(?:jpg|png|webp|gif|mp4|webm|mov))$/.exec(name || '');
  return match ? `/api/media/${match[1]}/${match[2]}` : null;
}

async function fetchAllowedMedia(sourceUrl, expectedKind, deps = {}) {
  let current = mediaUrl(sourceUrl);
  if (!current || isStoredMediaUrl(current)) throw new Error('Unsupported media source');
  const fetchImpl = deps.fetch || fetch;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual', signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 AscendantLabsMediaCache/1.0', accept: expectedKind === 'video' ? 'video/*' : 'image/*' },
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location') || '', current).href;
      current = mediaUrl(next);
      if (!current) throw new Error('Media redirect left the approved CDN');
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Media source returned HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extension = CONTENT_TYPES.get(contentType);
    if (!extension || (expectedKind === 'video') !== contentType.startsWith('video/')) throw new Error('Unexpected media content type');
    const limit = expectedKind === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT;
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > limit) throw new Error('Media exceeds ingestion size limit');
    const chunks = [];
    let total = 0;
    const hash = crypto.createHash('sha256');
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) throw new Error('Media exceeds ingestion size limit');
      hash.update(buffer); chunks.push(buffer);
    }
    if (!total) throw new Error('Empty media response');
    return { buffer: Buffer.concat(chunks, total), contentType, extension, hash: hash.digest('hex'), bytes: total };
  }
  throw new Error('Too many media redirects');
}

async function storeSource(adId, sourceUrl, kind, deps = {}) {
  if (isStoredMediaUrl(sourceUrl)) return { url: sourceUrl, bytes: 0, cached: true };
  const bucket = deps.bucket || getBucket();
  if (!bucket) throw new Error('Media storage is unavailable');
  const downloaded = await fetchAllowedMedia(sourceUrl, kind, deps);
  const name = objectName(adId, downloaded.hash, downloaded.extension);
  const file = bucket.file(name);
  const [exists] = await file.exists();
  if (!exists) {
    await file.save(downloaded.buffer, {
      resumable: false,
      metadata: {
        contentType: downloaded.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
        contentDisposition: 'inline',
        metadata: { adId: String(adId), sha256: downloaded.hash, sourceHost: new URL(sourceUrl).hostname },
      },
    });
  }
  return { url: publicMediaUrl(name), bytes: downloaded.bytes, cached: exists };
}

async function persistCreative(adId, creative, deps = {}) {
  const next = { ...creative };
  let stored = 0; let attempted = 0; let bytesDownloaded = 0;
  const imageSources = [...new Set([creative.thumbnailUrl, ...(creative.imageSources || [])]
    .filter(url => mediaUrl(url) || isStoredMediaUrl(url)))].slice(0, 4);
  const videoSources = [...new Set([creative.videoUrl, ...(creative.videoSources || [])]
    .filter(url => mediaUrl(url) || isStoredMediaUrl(url)))].slice(0, 4);
  const saveFirstAvailable = async (sources, kind) => {
    let lastError;
    for (const source of sources) {
      try { return await storeSource(adId, source, kind, deps); }
      catch (error) {
        lastError = error;
        if (error.message === 'Media storage is unavailable') break;
      }
    }
    throw lastError;
  };
  if (imageSources.length) {
    attempted++;
    try {
      const saved = await saveFirstAvailable(imageSources, 'image');
      next.thumbnailUrl = saved.url;
      next.imageSources = [...new Set([saved.url, ...(creative.imageSources || []), creative.thumbnailUrl].filter(Boolean))];
      stored++; bytesDownloaded += saved.bytes;
    } catch (error) {
      logger.warn('Asset ingestion failed', { adId: String(adId), kind: 'image',
        errorType: error.name || 'Error', reason: String(error.message || '').slice(0, 200) });
    }
  }
  if (videoSources.length) {
    attempted++;
    try {
      const saved = await saveFirstAvailable(videoSources, 'video');
      next.videoUrl = saved.url;
      next.videoSources = [...new Set([saved.url, ...(creative.videoSources || []), creative.videoUrl].filter(Boolean))];
      stored++; bytesDownloaded += saved.bytes;
    } catch (error) {
      logger.warn('Asset ingestion failed', { adId: String(adId), kind: 'video',
        errorType: error.name || 'Error', reason: String(error.message || '').slice(0, 200) });
    }
  }
  return { creative: next, stored, attempted, bytesDownloaded };
}

async function persistMedia(adId, media, deps = {}) {
  if (!media || media.status !== 'ready' || !/^\d{1,40}$/.test(String(adId))) return media;
  const creatives = [];
  let stored = 0; let attempted = 0; let bytesDownloaded = 0;
  for (const creative of (media.creatives || [media]).slice(0, MAX_CREATIVES)) {
    const result = await persistCreative(String(adId), creative, deps);
    creatives.push(result.creative); stored += result.stored; attempted += result.attempted;
    bytesDownloaded += result.bytesDownloaded;
  }
  if (!creatives.length) return media;
  logger.info('Ad asset ingestion completed', {
    adId: String(adId), stored, attempted, bytesDownloaded,
    status: stored === attempted && stored > 0 ? 'ready' : stored > 0 ? 'partial' : 'fallback',
  });
  return {
    ...media, ...creatives[0], creatives,
    storageStatus: stored === attempted && stored > 0 ? 'ready' : stored > 0 ? 'partial' : 'fallback',
    storedAt: stored > 0 ? Date.now() : null,
  };
}

async function persistMediaBatch(entries = {}, deps = {}) {
  const pairs = Object.entries(entries);
  const results = {};
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(4, Number(process.env.MEDIA_PERSIST_CONCURRENCY) || 2));
  async function worker() {
    while (cursor < pairs.length) {
      const [id, media] = pairs[cursor++];
      try { results[id] = await persistMedia(id, media, deps); }
      catch { retryStorageAt = Date.now() + 60000; results[id] = media; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
  return results;
}

async function streamStoredMedia(req, res, adId, fileName, deps = {}) {
  const match = /^([a-f0-9]{64})\.(jpg|png|webp|gif|mp4|webm|mov)$/.exec(fileName || '');
  const name = match && objectName(adId, match[1], match[2]);
  const bucket = deps.bucket || getBucket();
  if (!name || !bucket) return false;
  const file = bucket.file(name);
  let metadata;
  try { [metadata] = await file.getMetadata(); } catch { return false; }
  const size = Number(metadata.size || 0);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0; let end = Math.max(0, size - 1); let status = 200;
  if (range && size) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true;
    }
    status = 206;
  }
  const headers = {
    'Content-Type': metadata.contentType || 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: metadata.etag || `"${match[1]}"`,
    'X-Content-Type-Options': 'nosniff',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  file.createReadStream({ start, end }).on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }).pipe(res);
  return true;
}

function storageStatus() {
  return { enabled: process.env.MEDIA_STORAGE_DISABLED !== '1', bucket: BUCKET_NAME };
}

module.exports = { BUCKET_NAME, fetchAllowedMedia, getBucket, isStoredMediaUrl, objectName,
  persistCreative, persistMedia, persistMediaBatch, publicMediaUrl, storageStatus, storeSource, streamStoredMedia };
