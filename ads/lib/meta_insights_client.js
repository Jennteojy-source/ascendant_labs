/**
 * Meta Marketing API Client for CTWA Ad Evaluation Harness
 * Ascendant Labs / ScaleDM
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../functions/.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
  }
}

loadEnv();

const USER_TOKEN =
  process.env.USER_TOKEN ||
  process.env.META_ACCESS_TOKEN ||
  process.env.WABA_TOKEN ||
  process.env.CAPI_ACCESS_TOKEN;

const DEFAULT_ACCOUNT_ID = 'act_2342918112870520';

function fetchMeta(endpoint, params = {}) {
  if (!USER_TOKEN) {
    return Promise.reject(new Error('Missing USER_TOKEN or META_ACCESS_TOKEN in functions/.env'));
  }
  const queryParams = new URLSearchParams({
    access_token: USER_TOKEN,
    ...params,
  }).toString();

  const url = `https://graph.facebook.com/v21.0/${endpoint}?${queryParams}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Meta API error: ${parsed.error.message} (${parsed.error.code})`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Meta API response: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function parseActions(actionsList) {
  const actions = {};
  if (Array.isArray(actionsList)) {
    actionsList.forEach((a) => {
      actions[a.action_type] = parseInt(a.value, 10);
    });
  }
  return actions;
}

/**
 * Extract creative copy, headline, and image info from ad creative object
 */
function extractCreativeDetails(creative) {
  if (!creative) return {};
  const spec = creative.object_story_spec || {};
  const linkData = spec.link_data || {};
  const videoData = spec.video_data || {};
  const photoData = spec.photo_data || {};

  let headline = creative.title || linkData.name || videoData.title || '';
  let body = linkData.message || videoData.message || photoData.caption || '';
  let callToAction =
    (linkData.call_to_action && linkData.call_to_action.type) ||
    (videoData.call_to_action && videoData.call_to_action.type) ||
    '';
  let image = linkData.image_hash || linkData.picture || photoData.url || '';
  let conversationStarter = '';
  let icebreakers = [];
  if (linkData.page_welcome_message) {
    try {
      const pwm = typeof linkData.page_welcome_message === 'string'
        ? JSON.parse(linkData.page_welcome_message)
        : linkData.page_welcome_message;
      if (pwm.text_format && pwm.text_format.message) {
        conversationStarter = pwm.text_format.message.text || '';
        if (Array.isArray(pwm.text_format.message.ice_breakers)) {
          icebreakers = pwm.text_format.message.ice_breakers.map((ib) => ib.title || ib.text || '').filter(Boolean);
        }
      }
    } catch (_) {
      conversationStarter = String(linkData.page_welcome_message);
    }
  }

  return {
    creativeId: creative.id,
    creativeName: creative.name || '',
    headline,
    body,
    callToAction,
    image,
    conversationStarter,
    icebreakers,
  };
}

/**
 * Fetch all campaigns, ads, insights, and creatives for a given account and timeframe
 */
async function fetchAccountAdMetrics({
  accountId = DEFAULT_ACCOUNT_ID,
  datePreset = 'yesterday',
  timeRange = null,
  campaignFilter = null,
} = {}) {
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const accountInfo = await fetchMeta(actId, {
    fields: 'id,name,currency,account_status,business_name,amount_spent',
  }).catch((err) => {
    return { id: actId, name: actId, currency: 'USD', amount_spent: 0, error: err.message };
  });

  const campaignsRes = await fetchMeta(`${actId}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,daily_budget,created_time',
    limit: '50',
  }).catch(() => ({ data: [] }));

  let campaigns = campaignsRes.data || [];
  if (campaignFilter) {
    const filterLower = campaignFilter.toLowerCase();
    campaigns = campaigns.filter(
      (c) => c.name.toLowerCase().includes(filterLower) || c.id === campaignFilter
    );
  }

  const results = {
    account: accountInfo,
    datePreset,
    timeRange,
    fetchedAt: new Date().toISOString(),
    campaigns: [],
    adsMap: {},
  };

  const insightParams = {
    fields:
      'impressions,clicks,spend,reach,cpc,cpm,ctr,inline_link_clicks,inline_link_click_ctr,outbound_clicks,actions,cost_per_action_type',
  };

  if (timeRange && timeRange.since && timeRange.until) {
    insightParams.time_range = JSON.stringify(timeRange);
  } else {
    insightParams.date_preset = datePreset;
  }

  for (const campaign of campaigns) {
    const campInsightsRes = await fetchMeta(`${campaign.id}/insights`, insightParams).catch(
      () => ({ data: [] })
    );
    const campPerf = (campInsightsRes.data && campInsightsRes.data[0]) || {};
    const campActions = parseActions(campPerf.actions);

    const campaignSummary = {
      id: campaign.id,
      name: campaign.name,
      status: campaign.effective_status,
      objective: campaign.objective,
      spend: parseFloat(campPerf.spend || 0),
      impressions: parseInt(campPerf.impressions || 0, 10),
      clicks: parseInt(campPerf.clicks || 0, 10),
      linkClicks: parseInt(campPerf.inline_link_clicks || 0, 10),
      ctr: parseFloat(campPerf.ctr || 0),
      cpc: parseFloat(campPerf.cpc || 0),
      cpm: parseFloat(campPerf.cpm || 0),
      convsStarted:
        campActions['onsite_conversion.messaging_conversation_started_7d'] ||
        campActions['onsite_conversion.messaging_first_reply'] ||
        0,
      ads: [],
    };

    const adsRes = await fetchMeta(`${campaign.id}/ads`, {
      fields: 'id,name,status,effective_status,creative{id,name,title,object_story_spec}',
      limit: '100',
    }).catch(() => ({ data: [] }));

    if (adsRes.data) {
      for (const ad of adsRes.data) {
        const adInsightsRes = await fetchMeta(`${ad.id}/insights`, insightParams).catch(
          () => ({ data: [] })
        );
        const adPerf = (adInsightsRes.data && adInsightsRes.data[0]) || {};
        const adActions = parseActions(adPerf.actions);

        const adSpend = parseFloat(adPerf.spend || 0);
        const adImpressions = parseInt(adPerf.impressions || 0, 10);
        const adClicks = parseInt(adPerf.clicks || 0, 10);
        const adLinkClicks = parseInt(adPerf.inline_link_clicks || 0, 10);
        const adCtr = parseFloat(adPerf.ctr || 0);
        const adCpc = parseFloat(adPerf.cpc || 0);
        const adConvsStarted =
          adActions['onsite_conversion.messaging_conversation_started_7d'] ||
          adActions['onsite_conversion.messaging_first_reply'] ||
          adActions['onsite_conversion.messaging_user_initiated_conversation'] ||
          0;
        const adPurchases =
          adActions['purchase'] || adActions['offsite_conversion.fb_pixel_purchase'] || 0;

        const creativeDetails = extractCreativeDetails(ad.creative);

        const adRecord = {
          adId: ad.id,
          adName: ad.name,
          campaignId: campaign.id,
          campaignName: campaign.name,
          status: ad.effective_status,
          spend: adSpend,
          impressions: adImpressions,
          clicks: adClicks,
          linkClicks: adLinkClicks,
          ctr: adCtr,
          cpc: adCpc,
          convsStarted: adConvsStarted,
          costPerConvStarted: adConvsStarted > 0 ? adSpend / adConvsStarted : 0,
          purchases: adPurchases,
          creative: creativeDetails,
        };

        campaignSummary.ads.push(adRecord);
        results.adsMap[ad.id] = adRecord;
      }
    }

    results.campaigns.push(campaignSummary);
  }

  return results;
}

module.exports = {
  fetchAccountAdMetrics,
  fetchMeta,
  parseActions,
  DEFAULT_ACCOUNT_ID,
};
