/**
 * Website Crawler & Reference Image Downloader
 * Ascendant Labs / Meta Video Ad Generator
 * 
 * Traverses a product website, visits internal pages to understand the offer,
 * and downloads high-resolution product and lifestyle reference images.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Fetch HTML or asset with redirect following
 */
function fetchUrl(urlStr, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const maxRedirects = options.maxRedirects || 5;

  return new Promise((resolve) => {
    let currentUrl = urlStr;
    let redirectsCount = 0;

    function doRequest(targetUrl) {
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch (e) {
        return resolve({ statusCode: 0, headers: {}, body: '', error: 'Invalid URL: ' + targetUrl });
      }

      const client = parsed.protocol === 'http:' ? http : https;
      const reqOpts = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': options.binary ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(options.headers || {})
        },
        timeout: timeoutMs
      };

      const req = client.request(reqOpts, (res) => {
        // Handle Redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          redirectsCount++;
          if (redirectsCount > maxRedirects) {
            return resolve({ statusCode: res.statusCode, headers: res.headers, body: '', error: 'Too many redirects' });
          }
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          return doRequest(nextUrl);
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers || {},
            finalUrl: targetUrl,
            buffer: buffer,
            body: options.binary ? buffer : buffer.toString('utf8')
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ statusCode: 0, headers: {}, body: '', error: 'Request timeout' });
      });

      req.on('error', (err) => {
        resolve({ statusCode: 0, headers: {}, body: '', error: err.message });
      });

      req.end();
    }

    doRequest(currentUrl);
  });
}

/**
 * Clean HTML text and strip tags
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract links and page data from HTML
 */
function parsePageContent(html, baseUrlStr) {
  const baseUrl = new URL(baseUrlStr);
  const baseDomain = baseUrl.hostname.replace(/^www\./, '');

  // 1. Meta Tags
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  let metaDescription = '';
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (metaDescMatch) metaDescription = metaDescMatch[1].trim();

  let ogTitle = '';
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  if (ogTitleMatch) ogTitle = ogTitleMatch[1].trim();

  let ogImage = '';
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
  if (ogImageMatch) ogImage = ogImageMatch[1].trim();

  // 2. Headings
  const headings = [];
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = stripHtml(hMatch[2]);
    if (text && text.length > 3 && text.length < 200) {
      headings.push({ level: `h${hMatch[1]}`, text });
    }
  }

  // 3. Paragraphs & Bullet Points
  const textSnippets = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(html)) !== null) {
    const text = stripHtml(pMatch[1]);
    if (text && text.length > 25 && !text.toLowerCase().includes('copyright') && !text.toLowerCase().includes('cookie')) {
      textSnippets.push(text);
    }
  }

  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  const listItems = [];
  while ((liMatch = liRegex.exec(html)) !== null) {
    const text = stripHtml(liMatch[1]);
    if (text && text.length > 8 && text.length < 180) {
      listItems.push(text);
    }
  }

  // 4. Internal Links
  const internalLinks = new Set();
  const linkRegex = /<a[^>]*href=["']([^"'#\s]+)["'][^>]*>/gi;
  let aMatch;
  while ((aMatch = linkRegex.exec(html)) !== null) {
    const rawHref = aMatch[1].trim();
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue;
    }
    try {
      const resolved = new URL(rawHref, baseUrlStr);
      const linkDomain = resolved.hostname.replace(/^www\./, '');
      // Only keep links on the same domain
      if (linkDomain === baseDomain || linkDomain.endsWith('.' + baseDomain)) {
        // Strip query string and hashes for crawling deduplication
        resolved.hash = '';
        const cleanHref = resolved.toString();
        // Skip common asset extensions
        if (!/\.(pdf|zip|exe|dmg|apk|mp3|mp4|avi|mov)$/i.test(cleanHref)) {
          internalLinks.add(cleanHref);
        }
      }
    } catch (e) {
      // Ignore malformed links
    }
  }

  // 5. Image Candidates
  const imageCandidates = new Set();
  if (ogImage) {
    try {
      imageCandidates.add(new URL(ogImage, baseUrlStr).toString());
    } catch (e) {}
  }

  const imgRegex = /<img[^>]*>/gi;
  let imgTagMatch;
  while ((imgTagMatch = imgRegex.exec(html)) !== null) {
    const tag = imgTagMatch[0];
    // Extract src, data-src, data-original
    const srcMatch = tag.match(/(?:src|data-src|data-original)=["']([^"']+)["']/i);
    if (srcMatch) {
      const rawSrc = srcMatch[1].trim();
      if (!rawSrc.startsWith('data:') && !rawSrc.includes('pixel') && !rawSrc.includes('spacer')) {
        try {
          const resolvedImg = new URL(rawSrc, baseUrlStr).toString();
          imageCandidates.add(resolvedImg);
        } catch (e) {}
      }
    }

    // Extract srcset
    const srcsetMatch = tag.match(/srcset=["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',');
      parts.forEach(part => {
        const item = part.trim().split(/\s+/)[0];
        if (item && !item.startsWith('data:')) {
          try {
            imageCandidates.add(new URL(item, baseUrlStr).toString());
          } catch (e) {}
        }
      });
    }
  }

  return {
    title: ogTitle || title,
    metaDescription,
    headings,
    textSnippets: textSnippets.slice(0, 30),
    listItems: listItems.slice(0, 30),
    internalLinks: Array.from(internalLinks),
    imageCandidates: Array.from(imageCandidates)
  };
}

/**
 * Score relevance of internal links for priority crawling
 */
function scoreLinkPriority(urlStr) {
  const lower = urlStr.toLowerCase();
  let score = 0;
  if (lower.includes('product') || lower.includes('shop') || lower.includes('item')) score += 10;
  if (lower.includes('about') || lower.includes('story') || lower.includes('mission')) score += 8;
  if (lower.includes('feature') || lower.includes('how-it-works') || lower.includes('technology')) score += 9;
  if (lower.includes('ingredient') || lower.includes('formula') || lower.includes('science')) score += 9;
  if (lower.includes('review') || lower.includes('testimonial') || lower.includes('results')) score += 8;
  if (lower.includes('faq') || lower.includes('pricing') || lower.includes('plans')) score += 6;
  if (lower.includes('terms') || lower.includes('privacy') || lower.includes('policy') || lower.includes('login') || lower.includes('cart')) score -= 20;
  return score;
}

/**
 * Filter and prioritize quality reference images
 */
function isPromisingImage(urlStr) {
  const lower = urlStr.toLowerCase();
  // Filter out unwanted graphics, icons, badges, trackers
  if (lower.includes('logo') && !lower.includes('product')) return false;
  if (lower.includes('icon') || lower.includes('badge') || lower.includes('flag') || lower.includes('avatar')) return false;
  if (lower.includes('star') || lower.includes('arrow') || lower.includes('cart') || lower.includes('payment')) return false;
  if (lower.includes('.svg') || lower.includes('.gif')) return false;
  if (lower.includes('1x1') || lower.includes('tracking') || lower.includes('facebook') || lower.includes('google')) return false;
  return true;
}

/**
 * Download an image buffer and save to file
 */
async function downloadImageFile(imageUrl, targetPath) {
  const res = await fetchUrl(imageUrl, { binary: true, timeoutMs: 15000 });
  if (res.statusCode === 200 && res.buffer && res.buffer.length > 8000) { // must be > 8KB to avoid tiny icons
    fs.writeFileSync(targetPath, res.buffer);
    return {
      success: true,
      sizeBytes: res.buffer.length,
      path: targetPath,
      url: imageUrl
    };
  }
  return { success: false, error: res.error || `HTTP ${res.statusCode} or file too small (${res.buffer ? res.buffer.length : 0} bytes)` };
}

/**
 * Main Crawler Orchestrator
 */
async function crawlProductWebsite(startUrl, options = {}) {
  const maxPages = options.maxPages || 6;
  const maxImages = options.maxImages || 8;
  const outputImagesDir = options.outputImagesDir || null;

  console.log(`\n========================================================================`);
  console.log(` 🌐 PRODUCT WEBSITE CRAWLER & ASSET EXTRACTOR`);
  console.log(` Target Site:  ${startUrl}`);
  console.log(` Max Pages:    ${maxPages} internal links`);
  console.log(` Target Assets:${maxImages} reference images`);
  console.log(`========================================================================\n`);

  const visitedUrls = new Set();
  const queue = [{ url: startUrl, priority: 100 }];
  const crawledPages = [];
  const allImages = new Set();

  let pagesVisited = 0;

  while (queue.length > 0 && pagesVisited < maxPages) {
    // Pick highest priority link
    queue.sort((a, b) => b.priority - a.priority);
    const item = queue.shift();
    const currentUrl = item.url;

    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);

    console.log(`[Crawl ${pagesVisited + 1}/${maxPages}] Fetching: ${currentUrl}`);
    const res = await fetchUrl(currentUrl);

    if (res.statusCode !== 200 || !res.body) {
      console.log(`  └─ Failed or skipped (Status: ${res.statusCode || 'Error'})`);
      continue;
    }

    pagesVisited++;
    const parsed = parsePageContent(res.body, res.finalUrl || currentUrl);

    crawledPages.push({
      url: res.finalUrl || currentUrl,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      headings: parsed.headings,
      textSnippets: parsed.textSnippets,
      listItems: parsed.listItems
    });

    // Collect images
    parsed.imageCandidates.forEach(img => {
      if (isPromisingImage(img)) allImages.add(img);
    });

    // Enqueue discovered links
    parsed.internalLinks.forEach(link => {
      if (!visitedUrls.has(link) && !queue.some(q => q.url === link)) {
        const priority = scoreLinkPriority(link);
        if (priority >= 0) {
          queue.push({ url: link, priority });
        }
      }
    });

    console.log(`  └─ Discovered ${parsed.headings.length} headings, ${parsed.textSnippets.length} snippets, ${parsed.imageCandidates.length} images`);
  }

  // Synthesize Product Intelligence
  const primaryPage = crawledPages[0] || {};
  const allHeadings = crawledPages.flatMap(p => p.headings.map(h => h.text));
  const allSnippets = crawledPages.flatMap(p => p.textSnippets);
  const allLists = crawledPages.flatMap(p => p.listItems);

  // Extract core brand name
  let brandName = '';
  try {
    const host = new URL(startUrl).hostname.replace(/^www\./, '');
    brandName = host.split('.')[0];
    brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1);
  } catch (e) {
    brandName = 'Product';
  }

  const navBlacklist = /^(home|about|about\s+[\w\d]+|contact|contact\s+us|ingredients|references|disclaimer|terms|privacy|shipping|returns|refund|order|buy|faq|login|cart|checkout)$/i;
  const meaningfulLists = allLists.filter(item => {
    const trimmed = item.trim();
    return trimmed.length > 5 && !navBlacklist.test(trimmed);
  });
  const meaningfulHeadings = allHeadings.filter(item => {
    const trimmed = item.trim();
    return trimmed.length > 5 && !navBlacklist.test(trimmed);
  });

  const productIntel = {
    brandName: brandName,
    siteUrl: startUrl,
    title: primaryPage.title || '',
    metaDescription: primaryPage.metaDescription || '',
    keyHeadings: meaningfulHeadings.slice(0, 15),
    topFeaturesAndBenefits: meaningfulLists.slice(0, 15),
    coreContentSnippets: allSnippets.slice(0, 12),
    pagesAnalyzed: crawledPages.map(p => ({ url: p.url, title: p.title }))
  };

  // Download reference images if directory provided
  const downloadedAssets = [];
  if (outputImagesDir) {
    if (!fs.existsSync(outputImagesDir)) {
      fs.mkdirSync(outputImagesDir, { recursive: true });
    }

    console.log(`\n📸 Downloading high-res reference images to: ${outputImagesDir}`);
    const candidateList = Array.from(allImages);
    let count = 0;

    for (let i = 0; i < candidateList.length && count < maxImages; i++) {
      const imgUrl = candidateList[i];
      let ext = path.extname(new URL(imgUrl).pathname).toLowerCase();
      if (!ext || !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        ext = '.jpg';
      }

      const filename = `ref_asset_${String(count + 1).padStart(2, '0')}${ext}`;
      const targetPath = path.join(outputImagesDir, filename);

      const dlResult = await downloadImageFile(imgUrl, targetPath);
      if (dlResult.success) {
        count++;
        downloadedAssets.push({
          index: count,
          filename: filename,
          filepath: targetPath,
          sourceUrl: imgUrl,
          sizeKb: Math.round(dlResult.sizeBytes / 1024)
        });
        console.log(`  [Asset #${count}] Saved ${filename} (${Math.round(dlResult.sizeBytes / 1024)} KB) from ${imgUrl.slice(0, 70)}...`);
      }
    }
  }

  return {
    productIntel,
    crawledPagesCount: crawledPages.length,
    discoveredImagesCount: allImages.size,
    downloadedAssets
  };
}

module.exports = {
  crawlProductWebsite,
  fetchUrl,
  parsePageContent
};
