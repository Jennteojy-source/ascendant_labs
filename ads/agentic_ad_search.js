#!/usr/bin/env node
/**
 * Agentic Meta Ad Search & Competitor Intelligence Engine
 * Ascendant Labs
 * 
 * Takes a product PDP or offer URL, extracts semantic profile,
 * runs a multi-vector comparable search against Meta Ads Library,
 * deduplicates and ranks by impressions + longevity, and sniffs
 * high-res thumbnails and MP4 video streams for the active page.
 * 
 * Usage:
 *   node ads/agentic_ad_search.js "https://derila-ergo.com"
 *   node ads/agentic_ad_search.js "https://nordvpn.com" --page 1 --limit 10
 *   node ads/agentic_ad_search.js "memory foam pillow" --status ACTIVE
 */

const fs = require('fs');
const path = require('path');
const { profilePDP } = require('./lib/pdp_profiler');
const { findComparables } = require('./lib/comparable_finder');
const { deduplicateAndRankAds, paginateAds } = require('./lib/ad_ranker');
const { sniffPageMedia } = require('./lib/paginated_sniffer');

// Parse CLI args
const args = process.argv.slice(2);
let input = '';
let page = 1;
let pageSize = 10;
let status = 'ACTIVE';
let countries = ['US', 'GB', 'CA', 'AU'];
let shouldSniff = true;
let outputPath = '';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--page' || arg === '-p') page = parseInt(args[++i], 10) || 1;
  else if (arg === '--limit' || arg === '-l') pageSize = parseInt(args[++i], 10) || 10;
  else if (arg === '--status' || arg === '-s') status = args[++i].toUpperCase();
  else if (arg === '--countries' || arg === '-c') countries = args[++i].split(',').map(s => s.trim().toUpperCase());
  else if (arg === '--no-sniff') shouldSniff = false;
  else if (arg === '--output' || arg === '-o') outputPath = args[++i];
  else if (!arg.startsWith('-') && !input) input = arg;
}

if (!input) {
  console.log(`
Usage: node ads/agentic_ad_search.js <PRODUCT_PDP_OR_KEYWORD> [options]

Options:
  --page, -p        Pagination page (default: 1)
  --limit, -l       Ads per page (default: 10)
  --status, -s      Ad delivery status: ACTIVE | ALL (default: ACTIVE)
  --countries, -c   Comma-separated countries (default: US,GB,CA,AU)
  --no-sniff        Skip Playwright media sniffing
  --output, -o      Save full JSON dossier to file
  `);
  process.exit(1);
}

async function runAgenticSearch(targetInput) {
  const isUrl = /^https?:\/\//i.test(targetInput) || targetInput.includes('.com') || targetInput.includes('.io') || targetInput.includes('.net');
  console.log(`\n========================================================================`);
  console.log(` 🕵️‍♂️ AGENTIC META AD INTELLIGENCE & COMPARABLE ENGINE`);
  console.log(` Target Input:  ${targetInput}`);
  console.log(` Mode:          ${isUrl ? 'Product PDP Crawl & Multi-Vector Loop' : 'Keyword Direct Search'}`);
  console.log(` Status:        ${status} | Countries: ${countries.join(', ')}`);
  console.log(` Page:          ${page} (${pageSize} ads per page) | Sniff Media: ${shouldSniff}`);
  console.log(`========================================================================\n`);

  let profile = null;
  let searchVectors = [];

  if (isUrl) {
    console.log(`[Phase 1/4] Crawling & Profiling Product PDP...`);
    profile = await profilePDP(targetInput);
    console.log(`  ✓ Brand:     ${profile.brandName}`);
    console.log(`  ✓ Category:  ${profile.category}`);
    console.log(`  ✓ Product:   ${profile.coreProduct}`);
    console.log(`  ✓ Pains:     ${profile.primaryPainPoints.join(', ')}`);
    searchVectors = profile.suggestedVectors;
  } else {
    searchVectors = [
      { type: 'KEYWORD', query: targetInput },
      { type: 'HOOK_PROBLEM', query: `${targetInput} review` },
      { type: 'CATEGORY', query: `${targetInput} deal` }
    ];
  }

  console.log(`\n[Phase 2/4] Executing Multi-Vector Comparable Search Loop...`);
  for (const v of searchVectors) {
    console.log(`  → Vector [${v.type}]: "${v.query}"`);
  }

  const searchResult = await findComparables({
    vectors: searchVectors,
    countries,
    status,
    limitPerVector: 25,
    enableAgenticLoop: true,
  }, {
    vectors: searchVectors,
    countries,
    status,
    limitPerVector: 25,
  });

  console.log(`  ✓ Raw Ads Discovered: ${searchResult.totalRawAds}`);
  if (searchResult.discoveredCompetitors.length > 0) {
    console.log(`  ✓ Discovered Competitor Pages: ${searchResult.discoveredCompetitors.join(', ')}`);
  }

  console.log(`\n[Phase 3/4] Deduplicating & Ranking by Impressions + Longevity...`);
  const rankedAds = deduplicateAndRankAds(searchResult.ads, {
    countries,
    targetBrand: profile ? profile.brandName : targetInput,
    coreKeywords: profile ? [profile.coreProduct, ...(profile.searchKeywords || [])] : [targetInput],
    targetDomain: profile ? profile.domain : '',
  });
  console.log(`  ✓ Unique Creatives After Deduplication: ${rankedAds.length}`);

  const paginated = paginateAds(rankedAds, page, pageSize);
  console.log(`  ✓ Displaying Page ${paginated.currentPage} of ${paginated.totalPages} (${paginated.items.length} ads)`);

  if (shouldSniff && paginated.items.length > 0) {
    console.log(`\n[Phase 4/4] Sniffing Media Assets on Page ${paginated.currentPage} (Playwright Sniffer)...`);
    const mediaMap = await sniffPageMedia(paginated.items);
    for (const item of paginated.items) {
      item.media = mediaMap[item.id] || { thumbnailUrl: null, videoUrl: null, mediaType: 'unknown' };
    }
  }

  // Print results summary
  console.log(`\n========================================================================`);
  console.log(` 🏆 TOP RANKED COMPETITOR ADS (PAGE ${paginated.currentPage}/${paginated.totalPages})`);
  console.log(`========================================================================\n`);

  paginated.items.forEach((ad, idx) => {
    const rankNum = (paginated.currentPage - 1) * paginated.pageSize + idx + 1;
    const statusIcon = ad.stats.isActive ? '🟢 ACTIVE' : '⚪ INACTIVE';
    console.log(`#${rankNum} [Score: ${ad.ranking.score} | Grade: ${ad.ranking.grade}] ${statusIcon}`);
    console.log(`   Advertiser:    ${ad.pageName} (Library ID: ${ad.id})`);
    console.log(`   Flight:        ${ad.stats.flightSummary}`);
    console.log(`   Scale Tier:    ${ad.stats.scaleTier}${ad.variantCount > 1 ? ` (Running on ${ad.variantCount} ad sets)` : ''}`);
    console.log(`   Countries:     ${ad.stats.countries.join(', ')}`);
    console.log(`   Primary Hook:  [${ad.copy.primaryHook}]`);
    if (ad.copy.headline) console.log(`   Headline:      "${ad.copy.headline}"`);
    console.log(`   Body Snippet:  "${ad.copy.body.slice(0, 140).replace(/\s+/g, ' ')}..."`);
    if (ad.media) {
      console.log(`   Media Type:    ${ad.media.mediaType.toUpperCase()}`);
      if (ad.media.thumbnailUrl) console.log(`   Thumbnail:     ${ad.media.thumbnailUrl.slice(0, 85)}...`);
      if (ad.media.videoUrl) console.log(`   Video MP4:     ${ad.media.videoUrl.slice(0, 85)}...`);
    }
    console.log(`   Ad Library:    ${ad.adLibraryUrl}`);
    console.log(`------------------------------------------------------------------------`);
  });

  if (outputPath) {
    const fullDossier = {
      profile,
      query: targetInput,
      totalAds: rankedAds.length,
      pagination: {
        currentPage: paginated.currentPage,
        pageSize: paginated.pageSize,
        totalPages: paginated.totalPages,
      },
      pageItems: paginated.items,
      allRankedItems: rankedAds,
    };
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(fullDossier, null, 2), 'utf8');
    console.log(`\n💾 Saved complete dossier to: ${outputPath}`);
  }

  return { profile, paginated, allRankedAds: rankedAds };
}

if (require.main === module) {
  runAgenticSearch(input).catch(err => {
    console.error(`[Error] Agentic search failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  runAgenticSearch,
};
