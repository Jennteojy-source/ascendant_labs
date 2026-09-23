#!/usr/bin/env node
/**
 * Master Meta Ads Video AI Generation Engine
 * Ascendant Labs
 * 
 * Takes a product or offer website, crawls all internal links to learn about
 * the product/service, downloads high-res reference images, conducts deep
 * research in the public Facebook Ads Library via Playwright, and outputs a complete
 * creative campaign suite with Video AI prompts, voice-overs, captions, and copy.
 * 
 * Usage:
 *   node ads/video_ad_generator.js "<PRODUCT_URL>" [options]
 *   npm run video:ad -- "<PRODUCT_URL>" [options]
 */

const fs = require('fs');
const path = require('path');
const { crawlProductWebsite } = require('./lib/website_crawler');
const { researchCompetitorMetaAds } = require('./lib/meta_ad_researcher');
const { buildCreativeCampaignSuite } = require('./lib/video_ad_builder');

function sanitizeSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function runMetaVideoAdGenerator(targetUrl, options = {}) {
  const startTime = Date.now();
  console.log(`\n========================================================================`);
  console.log(` 🎬 META ADS VIDEO AI PROMPT & CREATIVE GENERATION ENGINE`);
  console.log(` Product URL:    ${targetUrl}`);
  console.log(` Crawl Limit:   ${options.maxPages || 6} internal pages`);
  console.log(` Max Images:    ${options.maxImages || 8} reference assets`);
  console.log(` Meta Ad Spy:   ${options.skipSpy ? 'Skipped' : 'Enabled (public browser)'}`);
  console.log(`========================================================================\n`);

  // 1. Establish project directory
  let domainSlug = 'product';
  try {
    const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl);
    domainSlug = parsed.hostname.replace(/^www\./, '').split('.')[0];
  } catch (e) {
    domainSlug = 'product';
  }

  const campaignSlug = `${sanitizeSlug(domainSlug)}_meta_video_ads`;
  const baseCampaignDir = options.outputDir || path.resolve(__dirname, 'campaigns', campaignSlug);
  const imagesDir = path.join(baseCampaignDir, '01_reference_images');

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  // 2. Step 1 & 2: Crawl Website & Download Reference Images
  console.log(`[Phase 1/3] Crawling Product Website & Harvesting Reference Assets...`);
  const crawlResult = await crawlProductWebsite(targetUrl, {
    maxPages: options.maxPages || 6,
    maxImages: options.maxImages || 8,
    outputImagesDir: imagesDir
  });

  const { productIntel, downloadedAssets } = crawlResult;

  // 3. Step 3: Deep Research in the public Facebook Ads Library
  let adResearch = {
    totalAdsScanned: 0,
    activeAdsCount: 0,
    topWinningAds: [],
    topHooks: []
  };

  if (!options.skipSpy) {
    console.log(`\n[Phase 2/3] Performing browser-based Facebook Ads Library research...`);
    const searchKeywords = [
      domainSlug,
      `${domainSlug} deal`,
      `${domainSlug} review`,
      productIntel.title ? productIntel.title.split(' ').slice(0, 3).join(' ') : null
    ].filter(Boolean);

    try {
      adResearch = await researchCompetitorMetaAds(productIntel.brandName, searchKeywords, {
        countries: options.countries || ['US', 'GB', 'CA', 'AU'],
        limitPerTerm: options.limitPerTerm || 25
      });
    } catch (err) {
      console.warn(`  [Notice] Meta Ad Library browser research notice: ${err.message}`);
    }
  } else {
    console.log(`\n[Phase 2/3] Facebook Ads Library Research skipped by user flag.`);
  }

  // 4. Step 4 & 5: Generate Campaign Directory, Video AI Prompts, Voice-Overs & Copy
  console.log(`\n[Phase 3/3] Generating Video AI Prompts, Storyboards & Meta Ad Copy...`);
  const suiteResult = buildCreativeCampaignSuite(baseCampaignDir, {
    productIntel,
    downloadedAssets,
    adResearch
  });

  const durationSec = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n========================================================================`);
  console.log(` ✨ CREATIVE CAMPAIGN GENERATION COMPLETE (${durationSec}s)`);
  console.log(` Output Directory: ${baseCampaignDir}`);
  console.log(`========================================================================`);
  console.log(` 📁 Generated Assets:`);
  console.log(`   1. 01_reference_images/            (${downloadedAssets.length} high-res downloaded assets)
   2. 02_market_research/             (Competitor intelligence & winning hooks)
   3. 03_video_production_script.md  (Unified Video AI Prompts, Voice-Overs & Captions)
   4. 04_meta_ad_copy_package.md      (High-CTR Meta Ad Copy variants for this video)
========================================================================\n`);

  return {
    campaignDir: baseCampaignDir,
    productIntel,
    downloadedAssets,
    adResearch,
    suiteResult
  };
}

module.exports = {
  runMetaVideoAdGenerator
};

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetUrl = null;
  const options = {
    maxPages: 6,
    maxImages: 8,
    countries: ['US', 'GB', 'CA', 'AU'],
    outputDir: null,
    skipSpy: false
  };

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Meta Ads Video AI Prompt & Creative Suite Generator
Ascendant Labs

Usage:
  node ads/video_ad_generator.js "<PRODUCT_URL>" [options]
  npm run video:ad -- "<PRODUCT_URL>" [options]

Options:
  -u, --url <url>           Product website URL (Required)
  -p, --max-pages <number>  Max internal pages to crawl (default: 6)
  -i, --max-images <number> Max reference images to download (default: 8)
  -c, --countries <codes>   Comma-separated target country codes (default: US,GB,CA,AU)
  -o, --output <path>       Custom output directory path
  --skip-spy                Skip public Meta Ads Library browser research
  -h, --help                Show this help message

Examples:
  node ads/video_ad_generator.js "https://derila-ergo.com"
  node ads/video_ad_generator.js "https://drinkag1.com" -p 8 -i 10
  node ads/video_ad_generator.js "https://prodentim.com" --skip-spy
`);
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' || arg === '-u') {
      targetUrl = args[++i];
    } else if (arg === '--max-pages' || arg === '-p') {
      options.maxPages = parseInt(args[++i], 10) || 6;
    } else if (arg === '--max-images' || arg === '-i') {
      options.maxImages = parseInt(args[++i], 10) || 8;
    } else if (arg === '--countries' || arg === '-c') {
      options.countries = args[++i].split(',').map(s => s.trim().toUpperCase());
    } else if (arg === '--output' || arg === '-o') {
      options.outputDir = args[++i];
    } else if (arg === '--skip-spy') {
      options.skipSpy = true;
    } else if (!arg.startsWith('-') && !targetUrl) {
      targetUrl = arg;
    }
  }

  if (!targetUrl) {
    console.error('Error: Please provide a product website URL.');
    process.exit(1);
  }

  runMetaVideoAdGenerator(targetUrl, options).catch(err => {
    console.error('Fatal Error running Meta Video Ad Generator:', err);
    process.exit(1);
  });
}
