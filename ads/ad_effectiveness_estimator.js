#!/usr/bin/env node
/**
 * Meta Ad Effectiveness & CTR Estimator Engine
 * Ascendant Labs
 * 
 * Analyzes Meta Ads Library campaigns using industry performance heuristics:
 * 1. Flight Longevity & Continuity (Media buyer scaling proxy)
 * 2. Copy Hook & Psychology (Curiosity, Urgency, Friction, Specificity)
 * 3. Scaling & Distribution (Platform coverage, Duplication, Verified Reach)
 * 
 * Outputs:
 * - Estimated CTR (Click-Through Rate %)
 * - Estimated CPC ($)
 * - Estimated Bridge Page Conversion Rate (CVR %)
 * - Composite Ad Effectiveness Score (0 - 100) & Grade
 */

const fs = require('fs');
const path = require('path');

function analyzeHook(headline = '', body = '') {
  const fullText = (headline + ' ' + body).toLowerCase();
  let hookScore = 0;
  const detectedTriggers = [];

  // 1. High-Converting Emotional Triggers (+5 each)
  const triggers = [
    { name: 'Urgency/Fear', regex: /\b(risk|paranoia|safe|snoop|hack|leaked|expose|threat|stolen|stop)\b/i, pts: 6 },
    { name: 'Financial Arbitrage', regex: /\b(70%|74%|75%|free|deal|discount|save|\$|£|coffee|cheap)\b/i, pts: 6 },
    { name: 'Friction Eliminator', regex: /\b(one tap|10 seconds|instant|simple|quietly|background|10 devices)\b/i, pts: 6 },
    { name: 'Performance/Speed', regex: /\b(buffer|buffering|speed|fast|nordlynx|wireguard|4k|streaming|throttle)\b/i, pts: 6 },
    { name: 'Versus/Comparison', regex: /\b(vs|free vpn|compared|alternative|beat|better|test|review)\b/i, pts: 6 }
  ];

  triggers.forEach(t => {
    if (t.regex.test(fullText)) {
      hookScore += t.pts;
      detectedTriggers.push(t.name);
    }
  });

  // 2. Specificity Bonus: Numbers & Data Points (+4)
  if (/\b\d+(\%|k|mbps|devices|\$|£)\b/i.test(fullText)) {
    hookScore += 4;
    detectedTriggers.push('Numeric Specificity');
  }

  // 3. Length & Readability Penalty/Bonus
  const wordCount = body.split(/\s+/).length;
  if (wordCount >= 15 && wordCount <= 60) {
    hookScore += 3; // Sweet spot for Facebook feed
  } else if (wordCount > 120) {
    hookScore -= 3; // Wall of text penalty
  }

  return {
    score: Math.min(30, Math.max(5, hookScore)),
    triggers: detectedTriggers
  };
}

function calculateEffectiveness(ad, publisherAdCount = 1) {
  const duration = ad.duration_days || 1;
  const reach = ad.eu_total_reach || ad.reach_count || 0;
  const isActive = ad.is_active || false;
  const headline = (ad.ad_creative_link_titles || [ad.headline || ''])[0] || '';
  const body = (ad.ad_creative_bodies || [ad.body || ad.body_snippet || ''])[0] || '';

  // FACTOR 1: Longevity & Continuity Score (Max 40 points)
  // Industry Truth: Advertisers kill losing ads in 24-48 hours. Running >14 days proves high ROI.
  let longevityScore = 0;
  if (duration >= 20) longevityScore = 40;
  else if (duration >= 14) longevityScore = 34;
  else if (duration >= 8) longevityScore = 28;
  else if (duration >= 4) longevityScore = 20;
  else if (duration >= 2) longevityScore = 12;
  else longevityScore = 5;

  if (isActive && duration >= 2) longevityScore += 4; // Active campaign bonus

  // FACTOR 2: Creative & Copy Hook Score (Max 30 points)
  const hookAnalysis = analyzeHook(headline, body);
  const copyScore = hookAnalysis.score;

  // FACTOR 3: Scale & Distribution Score (Max 30 points)
  let scaleScore = 10; // baseline
  if (reach >= 2000) scaleScore += 15;
  else if (reach >= 1000) scaleScore += 10;
  else if (reach >= 100) scaleScore += 5;

  if (publisherAdCount >= 10) scaleScore += 5; // Heavy-spending publisher scaling variations

  // Total Composite Score (0 - 100)
  const totalScore = Math.min(100, longevityScore + copyScore + scaleScore);

  // ESTIMATED METRICS:
  // Baseline Meta CPM in Tier 1: $26.00
  const baselineCpm = 26.00;

  // CTR Model: Base 0.9%, scaled by copy score & longevity
  // Top decile Meta feed ads achieve 2.4% - 3.4% CTR; weak ads hit 0.8% - 1.1%
  let estCtr = 0.9 + (copyScore / 30) * 1.5 + (longevityScore / 40) * 0.8;
  estCtr = Math.round(estCtr * 100) / 100;

  // Estimated CPC = CPM / (CTR * 10)
  const estCpc = Math.round((baselineCpm / (estCtr * 10)) * 100) / 100;

  // Estimated Bridge Page Conversion Rate (CVR)
  // Editorial bridge pages average 2.5% - 4.5% conversion on warm click-outs
  let estCvr = 1.8 + (longevityScore / 40) * 2.2;
  estCvr = Math.round(estCvr * 10) / 10;

  // Grade Assignment
  let grade = 'C';
  if (totalScore >= 85) grade = 'A+ (Scaled Winner)';
  else if (totalScore >= 75) grade = 'A (Highly Profitable)';
  else if (totalScore >= 60) grade = 'B (Moderate Performer)';
  else if (totalScore >= 45) grade = 'C (Break-Even Test)';
  else grade = 'D/F (Killed Test Dud)';

  return {
    ad_id: ad.id || ad.ad_id,
    page_name: ad.page_name,
    duration_days: duration,
    is_active: isActive,
    headline: headline,
    body_snippet: body.substring(0, 100),
    effectiveness_score: totalScore,
    grade: grade,
    metrics: {
      estimated_ctr: `${estCtr.toFixed(2)}%`,
      estimated_cpc: `$${estCpc.toFixed(2)}`,
      estimated_bridge_cvr: `${estCvr.toFixed(1)}%`,
      confidence: duration >= 14 ? 'High (Proven Flight)' : (duration >= 4 ? 'Moderate' : 'Low (Short Test)')
    },
    triggers_found: hookAnalysis.triggers,
    bridge_url: ad.bridge_page_url || ad.bridge_url,
    affiliate_url: ad.final_affiliate_url || ad.affiliate_link,
    ad_library_link: `https://www.facebook.com/ads/library/?id=${ad.id || ad.ad_id}`
  };
}

// Ingest datasets and run evaluation
const highAdsPath = path.resolve(__dirname, 'pure_english_high_impression_vpn_ads.json');
const lowAdsPath = path.resolve(__dirname, 'pure_english_low_impression_vpn_ads.json');

const highAds = JSON.parse(fs.readFileSync(highAdsPath, 'utf8'));
const lowAds = JSON.parse(fs.readFileSync(lowAdsPath, 'utf8'));

// Publisher frequency map
const pubCounts = {};
[...highAds, ...lowAds].forEach(a => pubCounts[a.page_name] = (pubCounts[a.page_name] || 0) + 1);

console.log(`Analyzing ${highAds.length} high-impression ads and ${lowAds.length} test ads...`);

const evaluatedHigh = highAds.map(a => calculateEffectiveness(a, pubCounts[a.page_name] || 1));
evaluatedHigh.sort((a, b) => b.effectiveness_score - a.effectiveness_score);

const evaluatedLow = lowAds.map(a => calculateEffectiveness(a, pubCounts[a.page_name] || 1));
evaluatedLow.sort((a, b) => b.effectiveness_score - a.effectiveness_score);

// Save results
fs.writeFileSync(path.resolve(__dirname, 'ads_effectiveness_ranked.json'), JSON.stringify(evaluatedHigh, null, 2), 'utf8');

console.log('\n========================================================================');
console.log(' TOP 10 RATED ADS BY ESTIMATED EFFECTIVENESS & CTR');
console.log('========================================================================\n');

evaluatedHigh.slice(0, 10).forEach((a, i) => {
  console.log(`[#${i+1}] Score: ${a.effectiveness_score}/100 [${a.grade}]`);
  console.log(`     Ad ID: ${a.ad_id} | Page: ${a.page_name} | Flight: ${a.duration_days} days`);
  console.log(`     Est. CTR: ${a.metrics.estimated_ctr} | Est. CPC: ${a.metrics.estimated_cpc} | Est. CVR: ${a.metrics.estimated_bridge_cvr}`);
  console.log(`     Headline: "${a.headline}"`);
  console.log(`     Psychological Triggers: ${a.triggers_found.join(', ')}`);
  console.log(`     Link: ${a.ad_library_link}\n`);
});

console.log('\n========================================================================');
console.log(' SAMPLE KILLED TEST ADS (LOW SCORES)');
console.log('========================================================================\n');

evaluatedLow.slice(0, 3).forEach((a, i) => {
  console.log(`[Dud #${i+1}] Score: ${a.effectiveness_score}/100 [${a.grade}]`);
  console.log(`     Ad ID: ${a.ad_id} | Page: ${a.page_name} | Flight: ${a.duration_days} days`);
  console.log(`     Est. CTR: ${a.metrics.estimated_ctr} | Est. CPC: ${a.metrics.estimated_cpc}`);
  console.log(`     Headline: "${a.headline}"\n`);
});
