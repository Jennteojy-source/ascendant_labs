#!/usr/bin/env node
/**
 * Meta Marketing API Analysis Utility
 * Ascendant Labs / ScaleDM
 * 
 * Usage:
 *   node meta_ads/meta_marketing_api.js
 *   node meta_ads/meta_marketing_api.js --campaign "Nord Sales Campaign V2"
 *   node meta_ads/meta_marketing_api.js --account act_1287963342576057 --date-preset last_7d
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

// 1. Load Environment Variables
function loadEnv() {
  const envPath = path.resolve(__dirname, '../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}

loadEnv();

const USER_TOKEN = process.env.USER_TOKEN || process.env.META_ACCESS_TOKEN || process.env.CAPI_ACCESS_TOKEN;
const DEFAULT_ACCOUNT_ID = 'act_1287963342576057';
const DATASET_ID = process.env.DATASET_ID || '868721989329074';

if (!USER_TOKEN) {
  console.error("Error: USER_TOKEN or META_ACCESS_TOKEN not found in functions/.env");
  process.exit(1);
}

// Parse Command Line Arguments
const args = process.argv.slice(2);
let accountId = DEFAULT_ACCOUNT_ID;
let targetCampaignFilter = null;
let datePreset = 'maximum';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--account' && args[i + 1]) {
    accountId = args[i + 1].startsWith('act_') ? args[i + 1] : `act_${args[i + 1]}`;
    i++;
  } else if (args[i] === '--campaign' && args[i + 1]) {
    targetCampaignFilter = args[i + 1];
    i++;
  } else if (args[i] === '--date-preset' && args[i + 1]) {
    datePreset = args[i + 1];
    i++;
  }
}

// Graph API Helper
function fetchMeta(endpoint, params = {}) {
  const queryParams = new URLSearchParams({
    access_token: USER_TOKEN,
    ...params
  }).toString();
  
  const url = `https://graph.facebook.com/v20.0/${endpoint}?${queryParams}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function parseActions(actionsList) {
  const actions = {};
  if (Array.isArray(actionsList)) {
    actionsList.forEach(a => {
      actions[a.action_type] = parseInt(a.value, 10);
    });
  }
  return actions;
}

async function runAnalysis() {
  console.log(`=======================================================`);
  console.log(` META MARKETING API FUNNEL & CAMPAIGN ANALYZER`);
  console.log(` Target Account: ${accountId}`);
  console.log(` Date Preset:    ${datePreset}`);
  if (targetCampaignFilter) {
    console.log(` Filter:         ${targetCampaignFilter}`);
  }
  console.log(`=======================================================\n`);

  // Fetch Account Info
  const accountInfo = await fetchMeta(accountId, {
    fields: 'id,name,currency,account_status,business_name,amount_spent'
  });
  console.log(`Account Name: ${accountInfo.name || accountId} | Currency: ${accountInfo.currency} | Total Spent: $${accountInfo.amount_spent ? (accountInfo.amount_spent / 100).toFixed(2) : 0}\n`);

  // Fetch Campaigns
  const campaignsRes = await fetchMeta(`${accountId}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,created_time'
  });

  if (!campaignsRes.data || campaignsRes.data.length === 0) {
    console.log("No campaigns found in this ad account.");
    return;
  }

  let campaigns = campaignsRes.data;
  if (targetCampaignFilter) {
    campaigns = campaigns.filter(c => 
      c.name.toLowerCase().includes(targetCampaignFilter.toLowerCase()) || 
      c.id === targetCampaignFilter
    );
  }

  for (const campaign of campaigns) {
    console.log(`-------------------------------------------------------`);
    console.log(`CAMPAIGN: ${campaign.name} (ID: ${campaign.id})`);
    console.log(`Status: ${campaign.effective_status} | Objective: ${campaign.objective} | Daily Budget: $${campaign.daily_budget ? (campaign.daily_budget/100).toFixed(2) : 'N/A'}`);
    console.log(`-------------------------------------------------------`);

    // Fetch Campaign Insights
    const insightsRes = await fetchMeta(`${campaign.id}/insights`, {
      date_preset: datePreset,
      fields: 'impressions,clicks,spend,reach,cpc,cpm,ctr,inline_link_clicks,inline_link_click_ctr,outbound_clicks,actions,cost_per_action_type'
    });

    if (!insightsRes.data || insightsRes.data.length === 0) {
      console.log("  No performance data recorded for this date range.\n");
      continue;
    }

    const perf = insightsRes.data[0];
    const actions = parseActions(perf.actions);

    const impressions = parseInt(perf.impressions || 0, 10);
    const clicks = parseInt(perf.clicks || 0, 10);
    const linkClicks = parseInt(perf.inline_link_clicks || 0, 10);
    const spend = parseFloat(perf.spend || 0);
    const ctr = parseFloat(perf.ctr || 0);
    const cpc = parseFloat(perf.cpc || 0);
    const cpm = parseFloat(perf.cpm || 0);

    const lpv = actions['landing_page_view'] || actions['omni_landing_page_view'] || 0;
    const viewContent = actions['view_content'] || actions['onsite_web_view_content'] || 0;
    const leads = actions['lead'] || actions['offsite_conversion.fb_pixel_lead'] || 0;
    const completeReg = actions['complete_registration'] || actions['offsite_conversion.fb_pixel_complete_registration'] || 0;
    const initiateCheckout = actions['initiate_checkout'] || actions['offsite_conversion.fb_pixel_initiate_checkout'] || 0;
    const purchases = actions['purchase'] || actions['offsite_conversion.fb_pixel_purchase'] || 0;

    console.log(`📊 CORE METRICS:`);
    console.log(`  Spend:               $${spend.toFixed(2)} ${accountInfo.currency}`);
    console.log(`  Impressions:         ${impressions.toLocaleString()}`);
    console.log(`  CPM:                 $${cpm.toFixed(2)}`);
    console.log(`  All Clicks:          ${clicks.toLocaleString()} (CTR: ${ctr.toFixed(2)}%, CPC: $${cpc.toFixed(2)})`);
    console.log(`  Inline Link Clicks:  ${linkClicks.toLocaleString()}`);

    console.log(`\n🔻 FUNNEL ANALYSIS:`);
    console.log(`  1. Link Clicks:      ${linkClicks}`);
    console.log(`  2. Landing Page View:${lpv} (${linkClicks > 0 ? ((lpv/linkClicks)*100).toFixed(1) : 0}% connection rate)`);
    console.log(`  3. Quiz View Content:${viewContent} (${lpv > 0 ? ((viewContent/lpv)*100).toFixed(1) : 0}% of LPV)`);
    console.log(`  4. Quiz Completed:   ${completeReg || leads} (${viewContent > 0 ? (((completeReg||leads)/viewContent)*100).toFixed(1) : 0}% quiz completion rate)`);
    console.log(`  5. Initiate Checkout:${initiateCheckout} (${(completeReg||leads) > 0 ? ((initiateCheckout/(completeReg||leads))*100).toFixed(1) : 0}% clicked offer link)`);
    console.log(`  6. Purchases:        ${purchases} (${initiateCheckout > 0 ? ((purchases/initiateCheckout)*100).toFixed(1) : 0}% checkout conversion)`);

    // Fetch Ad Sets & Optimization Goals
    const adsetsRes = await fetchMeta(`${campaign.id}/adsets`, {
      fields: 'id,name,status,effective_status,targeting,optimization_goal,billing_event,promoted_object'
    });

    if (adsetsRes.data) {
      console.log(`\n⚙️ AD SET CONFIGURATION:`);
      adsetsRes.data.forEach(adset => {
        console.log(`  Ad Set Name:       ${adset.name} (${adset.id})`);
        console.log(`  Optimization Goal: ${adset.optimization_goal}`);
        if (adset.promoted_object) {
          console.log(`  Pixel ID:          ${adset.promoted_object.pixel_id}`);
          console.log(`  Optimized Event:   ${adset.promoted_object.custom_event_type || 'N/A'}`);
        }
      });
    }

    // Fetch Ads Breakdown
    const adsRes = await fetchMeta(`${campaign.id}/ads`, {
      fields: 'id,name,status,effective_status,creative{name,title,object_story_spec}'
    });

    if (adsRes.data) {
      console.log(`\n🎨 AD CREATIVES & PERFORMANCE:`);
      for (const ad of adsRes.data) {
        const adInsights = await fetchMeta(`${ad.id}/insights`, {
          date_preset: datePreset,
          fields: 'spend,clicks,ctr,inline_link_clicks,actions'
        });
        const adPerf = adInsights.data && adInsights.data[0] ? adInsights.data[0] : {};
        const adActions = parseActions(adPerf.actions);
        const adSpend = parseFloat(adPerf.spend || 0);
        const adLinkClicks = parseInt(adPerf.inline_link_clicks || 0, 10);
        const adIC = adActions['initiate_checkout'] || 0;
        const adPur = adActions['purchase'] || 0;

        console.log(`  Ad: ${ad.name} (${ad.id}) [Status: ${ad.effective_status}]`);
        console.log(`      Spend: $${adSpend.toFixed(2)} | Link Clicks: ${adLinkClicks} | InitiateCheckout: ${adIC} | Purchases: ${adPur}`);
      }
    }
    console.log(`\n`);
  }
}

runAnalysis().catch(err => {
  console.error("Execution error:", err);
});
