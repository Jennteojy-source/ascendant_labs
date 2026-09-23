#!/usr/bin/env node
/**
 * Facebook Ads Library ClickBank Affiliate Finder
 * Ascendant Labs
 * 
 * Searches the public Meta Ad Library in a browser for ClickBank affiliate ads,
 * filters out official ClickBank brand ads, and outputs Ad IDs, affiliate hoplinks,
 * and review URLs.
 * 
 * Usage:
 *   node ads/find_clickbank_ads.js
 *   node ads/find_clickbank_ads.js --limit 50 --countries US,GB,CA,AU
 *   node ads/find_clickbank_ads.js --active-only
 */

const { queryMetaArchive } = require('./lib/comparable_finder');

const args = process.argv.slice(2);
let limit = 50;
let countries = ['US', 'CA', 'GB', 'AU'];
let activeOnly = args.includes('--active-only');
let searchTerm = 'hop.clickbank.net';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[++i], 10);
  } else if (args[i] === '--countries' && args[i + 1]) {
    countries = args[++i].split(',').map(s => s.trim());
  } else if (args[i] === '--search' && args[i + 1]) {
    searchTerm = args[++i];
  }
}

async function run() {
  console.log(`=======================================================`);
  console.log(` FACEBOOK ADS LIBRARY CLICKBANK AFFILIATE FINDER`);
  console.log(` Search Term: ${searchTerm}`);
  console.log(` Countries:   ${countries.join(', ')}`);
  console.log(` Active Only: ${activeOnly}`);
  console.log(`=======================================================\n`);

  const response = await queryMetaArchive(searchTerm, {
    countries, status: activeOnly ? 'ACTIVE' : 'ALL', limit, mediaType: 'ALL',
  });
  if (response.error && !response.data.length) console.warn('Browser search notice:', response.error);
  const rawAds = response.data || [];
  console.log(`Fetched ${rawAds.length} raw ads.\n`);

  // Filter out official ClickBank brand ads
  const affiliateAds = rawAds.filter(ad => {
    const p = (ad.page_name || '').toLowerCase();
    const isClickBankBrand = p.includes('clickbank') || p.includes('click bank');
    const isInactive = activeOnly && !!ad.ad_delivery_stop_time;
    return !isClickBankBrand && !isInactive;
  });

  console.log(`Found ${affiliateAds.length} affiliate ads promoting ClickBank hoplinks:\n`);

  affiliateAds.forEach((ad, index) => {
    const title = (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) || 'Untitled';
    const caption = (ad.ad_creative_link_captions && ad.ad_creative_link_captions[0]) || '';
    const body = (ad.ad_creative_bodies && ad.ad_creative_bodies[0]) || '';
    const date = ad.ad_delivery_start_time || ad.ad_creation_time;
    const isActive = !ad.ad_delivery_stop_time;

    console.log(`[${index + 1}] Ad ID: ${ad.id} (${isActive ? 'ACTIVE' : 'INACTIVE'})`);
    console.log(`    Advertiser Page: ${ad.page_name}`);
    console.log(`    Delivery Start:  ${date}`);
    console.log(`    Headline/Title:  ${title}`);
    console.log(`    Hoplink/Caption: ${caption}`);
    console.log(`    Ad Copy:         ${body.replace(/\n+/g, ' ').substring(0, 120)}...`);
    console.log(`    Review in Meta:  https://www.facebook.com/ads/library/?id=${ad.id}`);
    console.log(`    Ad Snapshot:     ${ad.ad_snapshot_url}\n`);
  });
}

run().catch(console.error);
