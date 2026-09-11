/**
 * Funnel Inspector & Infrastructure Reconnaissance Module
 * Ascendant Labs
 * 
 * Capabilities:
 * 1. Follows HTTP 301/302/307 redirect chains and extracts affiliate tracking parameters (ClickBank, HasOffers, Tune, etc.)
 * 2. Fingerprints landing page tracking pixels (Meta Pixel, Google Tag Manager, Google Analytics, Microsoft Clarity, TikTok)
 * 3. Detects VSL video players (Vturb, Wistia, Vidalytics, Vimeo, YouTube) and decodes timed buy-button reveal delays
 * 4. Extracts direct checkout links (ClickBank pay links, Stripe, Shopify)
 * 5. Queries Certificate Transparency logs (crt.sh) to discover hidden subdomains and sister bridge pages
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Perform a single HTTP request with timeout
 */
function requestUrl(urlStr, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return resolve({ statusCode: 0, headers: {}, body: '', error: 'Invalid URL' });
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: timeoutMs
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers || {},
          body: body,
          location: res.headers.location || null
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, headers: {}, body: '', error: 'Timeout' });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 0, headers: {}, body: '', error: err.message });
    });

    req.end();
  });
}

/**
 * 1. Trace HTTP Redirect Chains and Harvest Affiliate Parameters
 */
async function traceRedirectChain(initialUrl, maxHops = 6) {
  const chain = [];
  const visited = new Set();
  let currentUrl = initialUrl.trim();
  if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
    currentUrl = 'https://' + currentUrl;
  }

  let hops = 0;
  let finalBody = '';
  let finalHeaders = {};

  while (hops < maxHops) {
    if (visited.has(currentUrl)) {
      chain.push({ url: currentUrl, statusCode: 310, note: 'Redirect loop detected' });
      break;
    }
    visited.add(currentUrl);

    const start = Date.now();
    const res = await requestUrl(currentUrl);
    const latency = Date.now() - start;

    let parsedUrl;
    try {
      parsedUrl = new URL(currentUrl);
    } catch(e) {
      parsedUrl = { hostname: '', pathname: '', searchParams: new URLSearchParams() };
    }

    const hopInfo = {
      hop: hops + 1,
      url: currentUrl,
      host: parsedUrl.hostname,
      statusCode: res.statusCode,
      latency_ms: latency,
      params: Object.fromEntries(parsedUrl.searchParams.entries())
    };
    chain.push(hopInfo);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.location) {
      hops++;
      let next = res.location;
      if (next.startsWith('/')) {
        next = `${parsedUrl.protocol}//${parsedUrl.host}${next}`;
      } else if (!next.startsWith('http://') && !next.startsWith('https://')) {
        next = `${parsedUrl.protocol}//${parsedUrl.host}/${next}`;
      }
      currentUrl = next;
    } else {
      finalBody = res.body;
      finalHeaders = res.headers;
      break;
    }
  }

  // Harvest affiliate parameters across entire chain
  const harvestedParams = {};
  chain.forEach(h => {
    Object.keys(h.params).forEach(k => {
      const lower = k.toLowerCase();
      if (['affiliate', 'aff', 'hop', 'vendor', 'tid', 'tracking_id', 'shield', 'hopid', 'offer_id', 'aff_id', 'pid', 'vtid'].includes(lower)) {
        harvestedParams[lower] = h.params[k];
      }
    });
  });

  return {
    initial_url: initialUrl,
    final_destination: currentUrl,
    total_hops: chain.length,
    redirect_chain: chain,
    harvested_affiliate_params: harvestedParams,
    final_body: finalBody,
    final_headers: finalHeaders || {}
  };
}

/**
 * 2. Landing Page Fingerprinting (Pixels, Video Players, Timer Delays, Checkouts)
 */
function inspectLandingPageContent(html, url = '', headers = {}) {
  if (!html || typeof html !== 'string') {
    return { error: 'Empty or invalid HTML content' };
  }

  // A. Tracking Pixels & Analytics
  const fbPixelMatches = html.match(/(?:fbq\(['"]init['"],\s*['"](\d+)['"]|tr\?id=(\d+))/gi) || [];
  const metaPixels = [...new Set(fbPixelMatches.map(m => {
    const match = m.match(/\d{9,18}/);
    return match ? match[0] : null;
  }).filter(Boolean))];

  const gtmMatches = html.match(/GTM-[A-Z0-9]+/g) || [];
  const gtmContainers = [...new Set(gtmMatches)];

  const gaMatches = html.match(/(UA-\d+-\d+|G-[A-Z0-9]+)/g) || [];
  const googleAnalytics = [...new Set(gaMatches)];

  const gadsMatches = html.match(/AW-[A-Z0-9]+/g) || [];
  const googleAds = [...new Set(gadsMatches)];

  const clarityMatches = html.match(/clarity\.ms\/tag\/["']?([a-z0-9]+)/gi) || [];
  const clarityIds = [...new Set(clarityMatches.map(m => m.split('/').pop().replace(/["']/g, '')))];

  const tiktokMatches = html.match(/ttq\.load\(['"]([A-Z0-9]+)['"]/gi) || [];
  const tiktokPixels = [...new Set(tiktokMatches.map(m => {
    const parts = m.match(/['"]([A-Z0-9]+)['"]/i);
    return parts ? parts[1] : null;
  }).filter(Boolean))];

  // B. Video Player Technology
  const videoPlayers = [];
  if (/converteai\.net|vturb-smartplayer|api\.vturb/i.test(html)) {
    videoPlayers.push('Vturb SmartPlayer (Converteai)');
  }
  if (/fast\.wistia\.com|wistia_embed/i.test(html)) {
    videoPlayers.push('Wistia Video Player');
  }
  if (/quick\.vidalytics\.com|vidalytics_embed/i.test(html)) {
    videoPlayers.push('Vidalytics Video Player');
  }
  if (/vimeo\.com\/video/i.test(html)) {
    videoPlayers.push('Vimeo Embedded Player');
  }
  if (/youtube\.com\/embed|youtube-nocookie/i.test(html)) {
    videoPlayers.push('YouTube Embedded Player');
  }

  // C. Timed Buy-Button Reveal (VSL Delay Detection)
  let buyButtonDelaySeconds = null;
  let delaySource = null;

  const displayHiddenMatch = html.match(/displayHiddenElements\((\d+)/i);
  if (displayHiddenMatch) {
    buyButtonDelaySeconds = parseInt(displayHiddenMatch[1], 10);
    delaySource = 'Vturb player displayHiddenElements() trigger';
  } else {
    const setTimeoutMatch = html.match(/setTimeout\([^,]+,\s*(\d{5,8})\)/i);
    if (setTimeoutMatch) {
      buyButtonDelaySeconds = Math.round(parseInt(setTimeoutMatch[1], 10) / 1000);
      delaySource = 'JavaScript setTimeout() delay trigger';
    }
  }

  let formattedDelay = 'None (Immediate Buy Button / Direct Order)';
  if (buyButtonDelaySeconds) {
    const mins = Math.floor(buyButtonDelaySeconds / 60);
    const secs = buyButtonDelaySeconds % 60;
    formattedDelay = `${buyButtonDelaySeconds}s (~${mins} min ${secs > 0 ? secs + 's' : ''})`;
  }

  // D. Checkout Gateways & Offer Links
  const checkoutLinks = [];
  const cbCheckoutMatches = html.match(/https?:\/\/[a-z0-9\.\-]+\.pay\.clickbank\.net\/[^\s"'<>]+/gi) || [];
  cbCheckoutMatches.forEach(l => checkoutLinks.push({ gateway: 'ClickBank Pay Link', url: l }));

  const stripeMatches = html.match(/https?:\/\/buy\.stripe\.com\/[^\s"'<>]+/gi) || [];
  stripeMatches.forEach(l => checkoutLinks.push({ gateway: 'Stripe Checkout', url: l }));

  const shopifyMatches = html.match(/https?:\/\/[a-z0-9\.\-]+\/checkouts\/[^\s"'<>]+/gi) || [];
  shopifyMatches.forEach(l => checkoutLinks.push({ gateway: 'Shopify Checkout', url: l }));

  const d24Matches = html.match(/https?:\/\/(?:www\.)?digistore24\.com\/(?:product|redir)\/[^\s"'<>]+/gi) || [];
  d24Matches.forEach(l => checkoutLinks.push({ gateway: 'Digistore24 Order Link', url: l }));

  // Unique checkouts
  const uniqueCheckouts = Array.from(new Map(checkoutLinks.map(c => [c.url, c])).values());

  // E. Infrastructure & Tech Stack Fingerprint
  const detectedTech = [];
  const serverHeader = (headers['server'] || '').toLowerCase();
  if (serverHeader.includes('cloudflare') || headers['cf-ray']) detectedTech.push('Cloudflare Edge Network & CDN');
  if (headers['x-amz-cf-id']) detectedTech.push('Amazon CloudFront CDN');
  if (serverHeader.includes('fastly') || headers['x-served-by']) detectedTech.push('Fastly CDN');
  if (serverHeader.includes('litespeed')) detectedTech.push('LiteSpeed Web Server');
  if (serverHeader.includes('nginx')) detectedTech.push('Nginx Web Server');
  if (serverHeader.includes('apache')) detectedTech.push('Apache HTTP Server');

  if (/wp-content|wp-includes/i.test(html)) detectedTech.push('WordPress CMS');
  if (/elementor/i.test(html)) detectedTech.push('Elementor Page Builder');
  if (/clickfunnels|cf-core/i.test(html)) detectedTech.push('ClickFunnels Lander');
  if (/leadpages/i.test(html)) detectedTech.push('Leadpages Lander');
  if (/shopify/i.test(html) || checkoutLinks.some(c => c.gateway.includes('Shopify'))) detectedTech.push('Shopify Platform');
  if (/woocommerce/i.test(html)) detectedTech.push('WooCommerce E-Commerce');
  if (/\.php(\?|$)/i.test(url)) detectedTech.push('PHP Dynamic Backend');

  return {
    page_title: (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || 'Unknown Title',
    tracking_pixels: {
      meta_pixel_ids: metaPixels,
      google_tag_manager: gtmContainers,
      google_analytics: googleAnalytics,
      google_ads_conversion: googleAds,
      microsoft_clarity: clarityIds,
      tiktok_pixels: tiktokPixels
    },
    video_infrastructure: {
      detected_players: videoPlayers.length > 0 ? videoPlayers : ['Standard HTML5 / Native Player'],
      buy_button_delay_seconds: buyButtonDelaySeconds,
      formatted_delay: formattedDelay,
      delay_mechanism: delaySource || 'Direct Buy Button'
    },
    checkout_gateways: uniqueCheckouts,
    tech_stack: [...new Set(detectedTech)]
  };
}

function extractRootDomain(hostname) {
  let clean = (hostname || '').toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].split(':')[0];
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const secondLast = parts[parts.length - 2];
  if (['co', 'com', 'org', 'net', 'edu', 'gov'].includes(secondLast) && parts[parts.length - 1].length === 2) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * 3. Subdomain Discovery via HackerTarget & Certificate Transparency (crt.sh)
 */
async function discoverSubdomains(rootDomain, timeoutMs = 6000) {
  const cleanDomain = extractRootDomain(rootDomain);
  const subdomains = new Set();

  // Primary: HackerTarget Hostsearch (fast, reliable DNS mapping)
  await new Promise((resolve) => {
    https.get(`https://api.hackertarget.com/hostsearch/?q=${cleanDomain}`, { headers: { 'User-Agent': USER_AGENT }, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data.includes('<html') && !data.startsWith('error')) {
          data.split('\n').forEach(line => {
            const host = line.split(',')[0].trim().toLowerCase();
            if (host && host.endsWith(cleanDomain) && host !== cleanDomain && !host.startsWith('*')) {
              subdomains.add(host.replace(/^www\./, ''));
            }
          });
        }
        resolve();
      });
    }).on('error', () => resolve()).on('timeout', () => resolve());
  });

  // Secondary fallback: crt.sh if subdomains set is small
  if (subdomains.size < 2) {
    await new Promise((resolve) => {
      https.get(`https://crt.sh/?q=%25.${cleanDomain}&output=json`, { headers: { 'User-Agent': USER_AGENT }, timeout: 4000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (Array.isArray(json)) {
              json.forEach(item => {
                if (item && item.name_value) {
                  item.name_value.split('\n').forEach(n => {
                    const cleaned = n.trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
                    if (cleaned.endsWith(cleanDomain) && cleaned !== cleanDomain) {
                      subdomains.add(cleaned);
                    }
                  });
                }
              });
            }
          } catch(e) {}
          resolve();
        });
      }).on('error', () => resolve()).on('timeout', () => resolve());
    });
  }

  return Array.from(subdomains).sort();
}

/**
 * 4. Combined Full Funnel Intelligence Suite
 */
async function inspectFullFunnel(targetUrl) {
  console.log(`\n  🔎 [Funnel Inspector] Tracing redirect chain and harvesting technical fingerprints...`);
  const redirectResult = await traceRedirectChain(targetUrl);
  
  let landingPageIntel = {};
  if (redirectResult.final_body) {
    landingPageIntel = inspectLandingPageContent(redirectResult.final_body, redirectResult.final_destination, redirectResult.final_headers || {});
  }

  // Extract root domain for subdomain discovery
  let rootDomain = '';
  try {
    const u = new URL(redirectResult.final_destination);
    const parts = u.hostname.split('.');
    rootDomain = parts.slice(-2).join('.');
  } catch(e) {
    rootDomain = targetUrl.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  }

  console.log(`  🌐 [Recon] Querying Certificate Transparency logs for: ${rootDomain}...`);
  const subdomains = await discoverSubdomains(rootDomain);

  return {
    target_url: targetUrl,
    final_destination: redirectResult.final_destination,
    hops_count: redirectResult.total_hops,
    redirect_chain: redirectResult.redirect_chain.map(h => ({
      hop: h.hop,
      url: h.url,
      statusCode: h.statusCode,
      latency_ms: h.latency_ms
    })),
    affiliate_signatures: redirectResult.harvested_affiliate_params,
    page_intelligence: landingPageIntel,
    infrastructure_subdomains: subdomains
  };
}

module.exports = {
  requestUrl,
  traceRedirectChain,
  inspectLandingPageContent,
  discoverSubdomains,
  inspectFullFunnel
};

// Standalone CLI execution
if (require.main === module) {
  const target = process.argv[2] || 'https://theenergyrevolution.net/cb_redirect.php?&shield=a0b7ez50jmjapw522niuatdxcl';
  console.log(`Running Funnel Inspector on: ${target}\n`);
  inspectFullFunnel(target).then(res => {
    console.log(JSON.stringify(res, null, 2));
  });
}
