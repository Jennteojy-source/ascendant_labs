#!/usr/bin/env node
/**
 * Affiliate Ad Spy & Performance Intelligence Engine
 * Inspired by AdPlexity & AdSpy Architecture
 * Ascendant Labs
 * 
 * Takes an affiliate program link, tracking URL, or merchant product domain,
 * discovers all Meta ads promoting it, resolves the funnel/destination,
 * and estimates CTR, CPC, impressions, spend, and overall effectiveness.
 * 
 * Usage:
 *   node ads/affiliate_spy_engine.js --url "https://go.nordvpn.net/aff_c?offer_id=15"
 *   node ads/affiliate_spy_engine.js --url "https://prodentim.com"
 *   node ads/affiliate_spy_engine.js --url "https://derila-ergo.com"
 *   node ads/affiliate_spy_engine.js --url "https://go.getproton.me/aff_c?offer_id=26"
 */

const fs = require('fs');
const path = require('path');
const { inspectFullFunnel } = require('./lib/funnel_inspector');
const { queryMetaArchive } = require('./lib/comparable_finder');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    });
  }
}
loadEnv();

// 2. Affiliate URL & Tracker Intelligence Parser (AdPlexity Methodology)
function parseAffiliateInput(inputUrl) {
  let cleanUrl = inputUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = 'https://' + cleanUrl;
  }

  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch(e) {
    parsed = { hostname: cleanUrl, pathname: '', searchParams: new URLSearchParams() };
  }

  const host = parsed.hostname.toLowerCase();
  const search = parsed.searchParams;
  let network = 'Direct Merchant / Independent';
  let trackingDomain = host;
  let brandKeywords = [];
  let offerId = null;

  // Network Footprint Detection
  if (host.includes('nordvpn.net') || host.includes('getproton.me') || host.includes('nordpass.io') || parsed.pathname.includes('aff_c')) {
    network = 'Tune / HasOffers';
    offerId = search.get('offer_id');
    if (host.includes('nordvpn')) brandKeywords = ['nordvpn', 'nord vpn'];
    else if (host.includes('proton')) brandKeywords = ['proton vpn', 'protonvpn', 'proton'];
    else if (host.includes('nordpass')) brandKeywords = ['nordpass'];
  } else if (host.includes('clickbank') || host.startsWith('hop.') || host.includes('.hop.')) {
    network = 'ClickBank';
    const vendor = search.get('vendor') || parsed.pathname.replace(/^\//, '');
    brandKeywords = [vendor];
  } else if (host.includes('tradedoubler')) {
    network = 'TradeDoubler';
    offerId = search.get('p');
  } else if (host.includes('skimresources') || host.includes('skimlinks')) {
    network = 'Skimlinks';
  } else if (host.includes('buygoods')) {
    network = 'BuyGoods';
  } else if (host.includes('digistore24')) {
    network = 'Digistore24';
  } else {
    // Extract brand from root domain (e.g., derila-ergo.com -> derila, prodentim.com -> prodentim)
    const parts = host.replace(/^www\./, '').split('.')[0].split('-');
    brandKeywords = [parts[0], host];
  }

  // Fallback brand keywords from host
  brandKeywords = brandKeywords.map(b => (b || '').trim()).filter(Boolean);
  if (brandKeywords.length === 0) {
    const rawBrand = host.replace(/^www\./, '').split('.')[0];
    if (rawBrand) brandKeywords = [rawBrand];
  }

  const primaryBrand = brandKeywords[0] || host;
  const searchTerms = [
    host,
    ...brandKeywords,
    `${primaryBrand} deal`,
    `${primaryBrand} discount`
  ].map(t => (t || '').trim()).filter(Boolean);

  return {
    original_url: cleanUrl,
    host: host,
    network: network,
    tracking_domain: trackingDomain,
    offer_id: offerId,
    brand_keywords: brandKeywords,
    search_terms: [...new Set(searchTerms)]
  };
}

// 3. NLP Copy Hook Analyzer (Copy & Creative Scoring)
function analyzeCopyHook(headline = '', body = '') {
  const fullText = (headline + ' ' + body).toLowerCase();
  let score = 0;
  const triggers = [];

  const rules = [
    { name: 'Urgency & Problem Pain', regex: /\b(risk|paranoia|safe|snoop|hack|leaked|expose|threat|stolen|stop|pain|sore|ache|stiff|warning|alert)\b/i, pts: 6 },
    { name: 'Financial Arbitrage', regex: /\b(70%|74%|75%|free|deal|discount|save|\$|£|coffee|cheap|gift card|bonus)\b/i, pts: 6 },
    { name: 'Friction Elimination', regex: /\b(one tap|10 seconds|instant|simple|quietly|background|10 devices|easy|automatic)\b/i, pts: 6 },
    { name: 'Performance & Results', regex: /\b(buffer|buffering|speed|fast|sleep|relief|wake up|results|proven|guarantee)\b/i, pts: 6 },
    { name: 'Versus / Comparison', regex: /\b(vs|free|compared|alternative|beat|better|test|review|why)\b/i, pts: 6 }
  ];

  rules.forEach(r => {
    if (r.regex.test(fullText)) {
      score += r.pts;
      triggers.push(r.name);
    }
  });

  if (/\b\d+(\%|k|mbps|devices|\$|£|months|days)\b/i.test(fullText)) {
    score += 4;
    triggers.push('Numeric Proof');
  }

  const words = body.split(/\s+/).length;
  if (words >= 15 && words <= 65) score += 3;

  return {
    score: Math.min(30, Math.max(5, score)),
    triggers: triggers
  };
}

// 4. Performance Heuristics Engine (Estimates CTR, CPC, CVR, Spend, Score)
function evaluateAdPerformance(ad, publisherScaleCount = 1) {
  const startDateStr = ad.ad_delivery_start_time || ad.ad_creation_time || null;
  const stopDateStr = ad.ad_delivery_stop_time || null;
  const start = new Date(startDateStr || Date.now());
  const stop = stopDateStr ? new Date(stopDateStr) : new Date();
  const durationDays = Math.max(1, Math.round((stop - start) / (1000 * 60 * 60 * 24)));
  const isActive = !stopDateStr;
  const reach = ad.eu_total_reach || (ad.impressions && ad.impressions.lower_bound) || 0;

  const headline = (ad.ad_creative_link_titles || [])[0] || '';
  const body = (ad.ad_creative_bodies || [])[0] || '';
  const caption = (ad.ad_creative_link_captions || [])[0] || '';
  const platforms = ad.publisher_platforms || [];

  // Longevity Score (0 - 40 pts)
  let longevityScore = 5;
  if (durationDays >= 20) longevityScore = 40;
  else if (durationDays >= 14) longevityScore = 34;
  else if (durationDays >= 8) longevityScore = 28;
  else if (durationDays >= 4) longevityScore = 20;
  else if (durationDays >= 2) longevityScore = 12;

  if (isActive && durationDays >= 2) longevityScore += 4;

  // Copy Score (0 - 30 pts)
  const hookResult = analyzeCopyHook(headline, body);
  const copyScore = hookResult.score;

  // Scale Score (0 - 30 pts)
  let scaleScore = 10;
  if (reach >= 5000) scaleScore += 18;
  else if (reach >= 1000) scaleScore += 12;
  else if (reach >= 100) scaleScore += 5;
  if (publisherScaleCount >= 5) scaleScore += 5;

  const totalScore = Math.min(100, longevityScore + copyScore + scaleScore);

  // Performance Estimates (Tier 1 Meta Benchmarks)
  const baselineCpm = 26.00;
  let estCtr = 0.95 + (copyScore / 30) * 1.45 + (longevityScore / 40) * 0.85;
  estCtr = Math.round(estCtr * 100) / 100;

  const estCpc = Math.round((baselineCpm / (estCtr * 10)) * 100) / 100;

  let estImpressionsLower = 0;
  let estImpressionsUpper = 0;
  if (reach > 0) {
    estImpressionsLower = Math.round(reach * 1.3);
    estImpressionsUpper = Math.round(reach * 2.4);
  } else {
    if (durationDays >= 20) { estImpressionsLower = 150000; estImpressionsUpper = 500000; }
    else if (durationDays >= 14) { estImpressionsLower = 80000; estImpressionsUpper = 250000; }
    else if (durationDays >= 7) { estImpressionsLower = 30000; estImpressionsUpper = 100000; }
    else if (durationDays >= 4) { estImpressionsLower = 10000; estImpressionsUpper = 35000; }
    else { estImpressionsLower = 1500; estImpressionsUpper = 6000; }
  }

  const estClicksLower = Math.round(estImpressionsLower * (estCtr / 100));
  const estClicksUpper = Math.round(estImpressionsUpper * (estCtr / 100));
  const estSpendLower = Math.round((estImpressionsLower / 1000) * baselineCpm);
  const estSpendUpper = Math.round((estImpressionsUpper / 1000) * baselineCpm);

  let grade = 'C (Break-Even Test)';
  if (totalScore >= 85) grade = 'A+ (Mega Scaled Winner)';
  else if (totalScore >= 75) grade = 'A (Highly Profitable Winner)';
  else if (totalScore >= 60) grade = 'B (Solid Performer)';
  else if (totalScore < 45) grade = 'D/F (Killed Test Dud)';

  return {
    id: ad.id,
    page_name: ad.page_name,
    page_id: ad.page_id,
    is_active: isActive,
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    flight_dates: {
      start: startDateStr,
      stop: stopDateStr || 'Present (Still Running)',
      duration_days: durationDays
    },
    where_active: {
      platforms: platforms.length > 0 ? platforms : ['facebook', 'instagram'],
      languages: ad.languages || ['en']
    },
    verified_meta_data: {
      real_eu_reach: ad.eu_total_reach || (reach > 0 ? reach : null),
      real_impressions_range: ad.impressions ? `${ad.impressions.lower_bound || 0} - ${ad.impressions.upper_bound || 0}` : null,
      data_source: 'Public Meta Ad Library browser extraction'
    },
    estimated_metrics: {
      estimated_ctr: `${estCtr.toFixed(2)}%`,
      estimated_cpc: `$${estCpc.toFixed(2)}`,
      estimated_clicks: `~${estClicksLower.toLocaleString()} - ${estClicksUpper.toLocaleString()}`,
      estimated_global_impressions: `~${estImpressionsLower.toLocaleString()} - ${estImpressionsUpper.toLocaleString()}`,
      estimated_spend: `$${estSpendLower.toLocaleString()} - $${estSpendUpper.toLocaleString()}`,
      estimation_model: 'Continuous Flight Longevity & NLP Copy Heuristics ($26.00 CPM Baseline)',
      confidence: durationDays >= 14 ? 'High' : (durationDays >= 4 ? 'Moderate' : 'Low')
    },
    headline: headline,
    caption: caption,
    body_snippet: body.replace(/\s+/g, ' ').substring(0, 140),
    ad_library_url: `https://www.facebook.com/ads/library/?id=${ad.id}`,
    effectiveness_score: totalScore,
    grade: grade,
    triggers: hookResult.triggers
  };
}

// 5. Main Execution Engine
async function spyOnAffiliateProgram(inputUrl, options = {}) {
  let intel = parseAffiliateInput(inputUrl);
  const searchCountries = options.countries || ['US', 'GB', 'CA', 'AU'];
  const activeStatus = options.status || 'ALL';
  const queryLimit = options.limit || '50';

  console.log(`========================================================================`);
  console.log(` 🕵️‍♂️ AFFILIATE AD SPY & PERFORMANCE INTELLIGENCE ENGINE`);
  console.log(` Target Input:     ${intel.original_url}`);
  console.log(` Detected Network: ${intel.network}`);
  console.log(` Tracking Domain:  ${intel.tracking_domain}`);
  console.log(` Countries:        ${searchCountries.join(', ')}`);
  console.log(` Status Filter:    ${activeStatus}`);
  console.log(`========================================================================\n`);

  // [1/4] Automated Funnel Reconnaissance & Technical Fingerprinting
  let funnelIntel = null;
  if (!options.skipFunnel) {
    try {
      console.log(`[1/4] Inspecting Funnel, Tracing Redirects & Fingerprinting Tech Stack...`);
      funnelIntel = await inspectFullFunnel(intel.original_url);

      // If redirected to a merchant or landing domain, enrich search terms
      if (funnelIntel.final_destination && funnelIntel.final_destination !== intel.original_url) {
        const resolvedIntel = parseAffiliateInput(funnelIntel.final_destination);
        resolvedIntel.brand_keywords.forEach(bk => {
          if (!intel.brand_keywords.includes(bk)) intel.brand_keywords.push(bk);
        });
        resolvedIntel.search_terms.forEach(st => {
          if (!intel.search_terms.includes(st)) intel.search_terms.push(st);
        });
      }

      console.log(`\n========================================================================`);
      console.log(` 🌐 FUNNEL RECONNAISSANCE & TECHNICAL FINGERPRINTS`);
      console.log(`========================================================================`);
      console.log(` Target URL:        ${funnelIntel.target_url}`);
      console.log(` Final Destination: ${funnelIntel.final_destination}`);
      console.log(` Redirect Hops:     ${funnelIntel.hops_count} hop(s) [${funnelIntel.redirect_chain.map(h => `${h.statusCode} (${h.latency_ms}ms)`).join(' -> ')}]`);

      const sigKeys = Object.keys(funnelIntel.affiliate_signatures || {});
      if (sigKeys.length > 0) {
        console.log(` Affiliate Params:  ${sigKeys.map(k => `${k}=${funnelIntel.affiliate_signatures[k]}`).join(', ')}`);
      } else {
        console.log(` Affiliate Params:  None detected in query parameters`);
      }

      const pi = funnelIntel.page_intelligence || {};
      console.log(` Page Title:        ${pi.page_title || 'N/A'}`);
      console.log(` Tech Stack:        ${(pi.tech_stack && pi.tech_stack.length > 0) ? pi.tech_stack.join(', ') : 'Standard Web Hosting'}`);

      const pixels = pi.tracking_pixels || {};
      const pixelReport = [];
      if (pixels.meta_pixel_ids && pixels.meta_pixel_ids.length > 0) pixelReport.push(`Meta Pixel: [${pixels.meta_pixel_ids.join(', ')}]`);
      if (pixels.google_tag_manager && pixels.google_tag_manager.length > 0) pixelReport.push(`GTM: [${pixels.google_tag_manager.join(', ')}]`);
      if (pixels.google_analytics && pixels.google_analytics.length > 0) pixelReport.push(`GA: [${pixels.google_analytics.join(', ')}]`);
      if (pixels.google_ads_conversion && pixels.google_ads_conversion.length > 0) pixelReport.push(`Google Ads: [${pixels.google_ads_conversion.join(', ')}]`);
      if (pixels.microsoft_clarity && pixels.microsoft_clarity.length > 0) pixelReport.push(`Clarity: [${pixels.microsoft_clarity.join(', ')}]`);
      if (pixels.tiktok_pixels && pixels.tiktok_pixels.length > 0) pixelReport.push(`TikTok: [${pixels.tiktok_pixels.join(', ')}]`);
      console.log(` Tracking Pixels:   ${pixelReport.length > 0 ? pixelReport.join(' | ') : 'No 3rd-party tracking tags detected'}`);

      const vi = pi.video_infrastructure || {};
      console.log(` Video Players:     ${(vi.detected_players && vi.detected_players.length > 0) ? vi.detected_players.join(', ') : 'None'}`);
      console.log(` Timed Cart Delay:  ${vi.formatted_delay || 'None'} [${vi.delay_mechanism || 'Direct Reveal'}]`);

      const co = pi.checkout_gateways || [];
      if (co.length > 0) {
        console.log(` Direct Checkouts:  ${co.map(c => `[${c.gateway}] ${c.url}`).join('\n                    ')}`);
      } else {
        console.log(` Direct Checkouts:  No direct cart or checkout URLs discovered on landing page`);
      }

      const subs = funnelIntel.infrastructure_subdomains || [];
      if (subs.length > 0) {
        console.log(` Discovered Subs:   ${subs.slice(0, 8).join(', ')}${subs.length > 8 ? ` (+${subs.length - 8} more)` : ''}`);
      } else {
        console.log(` Discovered Subs:   No sister subdomains found in public DNS logs`);
      }
      console.log(`========================================================================\n`);

    } catch (e) {
      console.log(`  [Funnel Inspector Notice] Skipped technical fingerprinting: ${e.message}`);
    }
  }

  const adsMap = new Map();

  console.log(`[2/4] Searching the public Meta Ads Library in browser mode...`);
  console.log(`  Search Vectors:   ${intel.search_terms.join(', ')}`);

  for (const term of intel.search_terms) {
    const res = await queryMetaArchive(term, { countries: searchCountries, status: activeStatus, limit: queryLimit });
    const data = res.data || [];
    let added = 0;
    data.forEach(ad => {
      if (ad && ad.id && !adsMap.has(ad.id)) {
        adsMap.set(ad.id, ad);
        added++;
      }
    });
    console.log(`  Query: "${term}" -> Found ${data.length} ads (${added} new unique)`);
  }

  const rawAds = Array.from(adsMap.values());
  console.log(`\n[3/4] Analyzing & Filtering ${rawAds.length} candidate ads...`);

  // Filter ads that genuinely promote this offer
  const matchedAds = rawAds.filter(ad => {
    const fullText = JSON.stringify(ad).toLowerCase();
    const matchesDomain = fullText.includes(intel.host.toLowerCase());
    const matchesBrand = intel.brand_keywords.some(b => fullText.includes(b.toLowerCase()));
    const matchesOffer = intel.offer_id ? fullText.includes(`offer_id=${intel.offer_id}`) || fullText.includes(intel.offer_id) : true;
    return (matchesDomain || matchesBrand) && matchesOffer;
  });

  console.log(`  Filtered to ${matchedAds.length} relevant affiliate/merchant ads.`);

  // Calculate publisher frequency
  const pubCounts = {};
  matchedAds.forEach(a => pubCounts[a.page_name] = (pubCounts[a.page_name] || 0) + 1);

  // Evaluate & Score
  const evaluated = matchedAds.map(ad => evaluateAdPerformance(ad, pubCounts[ad.page_name] || 1));
  evaluated.sort((a, b) => b.effectiveness_score - a.effectiveness_score);

  console.log(`\n[4/4] Performance Evaluation & Heuristics Scoring Complete!`);
  console.log(`========================================================================`);
  console.log(` 🏆 TOP RANKED ADS PROMOTING THIS AFFILIATE PROGRAM`);
  console.log(`========================================================================\n`);

  evaluated.slice(0, 10).forEach((ad, i) => {
    console.log(`[#${i + 1}] Score: ${ad.effectiveness_score}/100 [${ad.grade}]`);
    console.log(`     Publisher:     ${ad.page_name} | Ad ID: ${ad.id}`);
    console.log(`     Active Status: ${ad.status} [${ad.flight_dates.duration_days} days active: ${ad.flight_dates.start} -> ${ad.flight_dates.stop}]`);
    console.log(`     Where Active:  Platforms: [${ad.where_active.platforms.join(', ')}] | Languages: [${ad.where_active.languages.join(', ')}]`);
    if (ad.verified_meta_data.real_eu_reach) {
      console.log(`     Real Reach:    ${ad.verified_meta_data.real_eu_reach.toLocaleString()} disclosed users`);
    } else if (ad.verified_meta_data.real_impressions_range) {
      console.log(`     Real Impr:     ${ad.verified_meta_data.real_impressions_range} (public transparency data)`);
    } else {
      console.log(`     Real Impr:     Not disclosed in the public Library for this ad`);
    }
    console.log(`     Est. Metrics:  CTR: ${ad.estimated_metrics.estimated_ctr} | CPC: ${ad.estimated_metrics.estimated_cpc} | Clicks: ${ad.estimated_metrics.estimated_clicks}`);
    console.log(`     Est. Scale:    ${ad.estimated_metrics.estimated_global_impressions} global impr | Spend: ${ad.estimated_metrics.estimated_spend}`);
    console.log(`     Headline:      "${ad.headline || 'N/A'}"`);
    console.log(`     Link Caption:  "${ad.caption || 'N/A'}"`);
    console.log(`     Copy Snippet:  "${ad.body_snippet}..."`);
    console.log(`     Triggers:      ${ad.triggers.join(', ') || 'General'}`);
    console.log(`     Ad Library:    ${ad.ad_library_url}\n`);
  });

  // Comprehensive Intelligence Report
  const fullReport = {
    target_url: intel.original_url,
    final_destination: funnelIntel ? funnelIntel.final_destination : intel.original_url,
    brand: intel.brand_keywords[0],
    network: intel.network,
    timestamp: new Date().toISOString(),
    funnel_intelligence: funnelIntel,
    meta_ads_intelligence: {
      total_candidates: rawAds.length,
      total_matches: evaluated.length,
      active_ads_count: evaluated.filter(a => a.is_active).length,
      top_publishers: pubCounts,
      ads: evaluated
    }
  };

  // Export results
  const filename = options.output || `spy_results_${intel.brand_keywords[0].replace(/[^a-z0-9]/gi, '_')}.json`;
  const exportPath = path.isAbsolute(filename) ? filename : path.resolve(__dirname, filename);
  fs.writeFileSync(exportPath, JSON.stringify(fullReport, null, 2), 'utf8');
  console.log(`Detailed intelligence report exported to: ${exportPath}`);

  return fullReport;
}

// Module export
module.exports = {
  spyOnAffiliateProgram,
  parseAffiliateInput,
  evaluateAdPerformance,
  analyzeCopyHook
};

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetUrl = null;
  const options = {
    countries: ['US', 'GB', 'CA', 'AU'],
    status: 'ALL',
    limit: 50,
    output: null
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Affiliate Ad Spy & Performance Intelligence Engine
Ascendant Labs

Usage:
  node ads/affiliate_spy_engine.js <url> [options]
  node ads/affiliate_spy_engine.js --url <url> [options]

Options:
  -u, --url <url>            Affiliate tracking URL or merchant product domain (Required)
  -c, --countries <codes>    Comma-separated 2-letter country codes (default: US,GB,CA,AU)
  -s, --status <status>      Active status: ALL | ACTIVE | INACTIVE (default: ALL)
  -l, --limit <number>       Max ads per search vector query (default: 50)
  -o, --output <path>        Custom output JSON path (default: ads/spy_results_<brand>.json)
  -h, --help                 Show this help message

Examples:
  node ads/affiliate_spy_engine.js "https://go.nordvpn.net/aff_c?offer_id=15"
  node ads/affiliate_spy_engine.js "https://derila-ergo.com" --status ACTIVE
  node ads/affiliate_spy_engine.js "https://prodentim.com" -c US,CA -l 100
`);
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' || arg === '-u') {
      targetUrl = args[++i];
    } else if (arg === '--countries' || arg === '-c') {
      options.countries = args[++i].split(',').map(s => s.trim().toUpperCase());
    } else if (arg === '--status' || arg === '-s') {
      options.status = args[++i].toUpperCase();
    } else if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10) || 50;
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--skip-funnel' || arg === '--no-funnel') {
      options.skipFunnel = true;
    } else if (!arg.startsWith('-') && !targetUrl) {
      targetUrl = arg;
    }
  }

  if (!targetUrl) {
    targetUrl = 'https://go.nordvpn.net/aff_c?offer_id=15';
  }

  spyOnAffiliateProgram(targetUrl, options).catch(err => {
    console.error("Fatal Error running Affiliate Spy Engine:", err);
    process.exit(1);
  });
}
