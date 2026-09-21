/**
 * Ad Deduplication & Dual-Metric Ranking Engine
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Deduplicates identical creatives across ad sets, computes performance scores
 * based on impressions and active longevity, and structures ad stats.
 */

const crypto = require('crypto');

/**
 * Classify hook archetype from ad text
 */
function classifyHook(text = '', title = '') {
  const combined = `${title} ${text}`.toLowerCase();
  const triggers = [];

  if (/\b(stop|don't|never|mistake|worst|warning|avoid|danger|toxic)\b/i.test(combined)) {
    triggers.push('Warning / Pattern Interrupt');
  }
  if (/\b(secret|nobody tells you|hidden|truth|why|revealed)\b/i.test(combined)) {
    triggers.push('Curiosity Gap / Secret');
  }
  if (/\b(my husband|my wife|i tried|after 30 days|i was skeptical|finally|honest review)\b/i.test(combined)) {
    triggers.push('Authentic UGC Experience');
  }
  if (/\b(vs|alternative|switch|better than|ditch|replace)\b/i.test(combined)) {
    triggers.push('Direct Comparison / Competitor Flank');
  }
  if (/\b(hack|10 seconds|one tap|routine|habit|morning|bedtime)\b/i.test(combined)) {
    triggers.push('Low-Friction Daily Habit');
  }
  if (/\b(50% off|save|free shipping|discount|money back|guarantee|risk free)\b/i.test(combined)) {
    triggers.push('Financial Arbitrage / Low-Risk Offer');
  }

  const primaryHook = triggers.length > 0 ? triggers[0] : 'Direct Problem-Solution';
  return { primaryHook, triggers };
}

/**
 * Deduplicate and Rank Raw Ad Records
 */
function deduplicateAndRankAds(rawAds, options = {}) {
  const targetCountries = options.countries || ['US'];

  // 1. Group by creative fingerprint to collapse identical creatives
  const creativeGroups = new Map();

  for (const ad of rawAds) {
    const body = (ad.ad_creative_bodies && ad.ad_creative_bodies[0]) || '';
    const title = (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) || '';
    const pageName = ad.page_name || 'Unknown Page';

    // Hash normalized page + body snippet
    const normText = `${pageName.toLowerCase()}:::${body.slice(0, 120).toLowerCase().replace(/\s+/g, ' ')}`;
    const hash = crypto.createHash('md5').update(normText).digest('hex');

    if (!creativeGroups.has(hash)) {
      creativeGroups.set(hash, {
        primaryAd: ad,
        allAdIds: [ad.id],
        variantCount: 1,
      });
    } else {
      const group = creativeGroups.get(hash);
      group.allAdIds.push(ad.id);
      group.variantCount++;

      // Pick the ad with the earliest start time to reflect full creative longevity
      const existingStart = new Date(group.primaryAd.ad_delivery_start_time || 0).getTime();
      const newStart = new Date(ad.ad_delivery_start_time || 0).getTime();
      if (newStart > 0 && (newStart < existingStart || existingStart === 0)) {
        group.primaryAd = ad;
      }
    }
  }

  // 2. Score and Format Each Deduplicated Creative
  const rankedItems = [];

  for (const [, group] of creativeGroups.entries()) {
    const ad = group.primaryAd;
    const now = Date.now();

    // Flight Timeline
    const startDateRaw = ad.ad_delivery_start_time || ad.ad_creation_time;
    const endDateRaw = ad.ad_delivery_stop_time || null;
    const startMs = startDateRaw ? new Date(startDateRaw).getTime() : now;
    const endMs = endDateRaw ? new Date(endDateRaw).getTime() : now;

    const isActive = !endDateRaw || endMs > now - 24 * 3600 * 1000;
    const flightDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 3600 * 24)));

    const startFormatted = startDateRaw ? new Date(startDateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
    const endFormatted = endDateRaw ? new Date(endDateRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present';
    const flightSummary = isActive
      ? `Active for ${flightDays} day${flightDays === 1 ? '' : 's'} (${startFormatted} – Present)`
      : `Ran for ${flightDays} day${flightDays === 1 ? '' : 's'} (${startFormatted} – ${endFormatted})`;

    // Reach / Impression Index
    const euReach = ad.eu_total_reach ? Number(ad.eu_total_reach) : null;
    let scaleTier = 'Testing (<10k reach)';
    let impressionScore = 8;

    if (euReach && euReach > 50000) {
      scaleTier = 'High Scale (>50k reach)';
      impressionScore = 30;
    } else if (euReach && euReach >= 10000) {
      scaleTier = 'Mid Scale (10k–50k reach)';
      impressionScore = 20;
    } else if (flightDays >= 30 || group.variantCount >= 5) {
      scaleTier = 'High Scale (Multi-variant & 30d+ flight)';
      impressionScore = 28;
    } else if (flightDays >= 14) {
      scaleTier = 'Mid Scale (Consistent scaling)';
      impressionScore = 18;
    }

    // Copy and Hook Classification
    const body = (ad.ad_creative_bodies && ad.ad_creative_bodies[0]) || '';
    const headline = (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) || '';
    const caption = (ad.ad_creative_link_captions && ad.ad_creative_link_captions[0]) || '';
    const { primaryHook, triggers } = classifyHook(body, headline);
    const copyScore = Math.min(20, triggers.length * 5);

    // Spam / Unrelated Content Filter (Hard Disqualify)
    const combinedContent = `${ad.page_name || ''} ${headline} ${body} ${caption}`.toLowerCase();
    const isRomanceSpam = /\b(novel|chapter|billionaire|ceo|divorce|alpha male|werewolf|pregnant|forced to marry|manga|comic|webtoon|slots|casino|horoscope|zodiac|tarot|credit card|payday loan)\b/i.test(combinedContent);
    if (isRomanceSpam) {
      // Disqualify fiction, romance webnovels, casino, and junk apps completely
      continue;
    }

    // Strict Relevance Matching against Target Context
    const targetBrand = (options.targetBrand || '').toLowerCase().trim();
    const coreKeywords = (options.coreKeywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
    const targetDomain = (options.targetDomain || '').toLowerCase().trim();

    let relevanceType = 'NICHE_AD';
    let relevanceScore = 0;

    const brandMatched = targetBrand && targetBrand.length > 2 && combinedContent.includes(targetBrand);
    const domainMatched = targetDomain && targetDomain.length > 3 && combinedContent.includes(targetDomain);

    let categoryMatches = 0;
    for (const kw of coreKeywords) {
      if (kw.length > 2 && combinedContent.includes(kw)) {
        categoryMatches++;
      }
    }

    if (brandMatched || domainMatched) {
      relevanceType = 'DIRECT_BRAND';
      relevanceScore = 80;
    } else if (categoryMatches > 0) {
      relevanceType = 'COMPETITOR';
      relevanceScore = Math.min(50, 20 + categoryMatches * 10);
    } else if (coreKeywords.length > 0) {
      // If the user is searching a product/brand, exclude any ad that has 0 connection to it!
      continue;
    }

    // Dual-Metric Ranking Formula:
    // Rank = (FlightDays ^ 1.15) * ActiveWeight + ImpressionScore + CopyScore + VariantScaleBonus + RelevanceScore
    const activeWeight = isActive ? 1.35 : 1.0;
    const longevityComponent = Math.pow(flightDays, 1.15) * activeWeight;
    const variantBonus = Math.min(18, (group.variantCount - 1) * 3);
    const rawRankScore = longevityComponent + impressionScore + copyScore + variantBonus + relevanceScore;
    const rankScore = Math.max(0, Math.round(rawRankScore));

    // Grade assignment
    let grade = 'C';
    if (rankScore >= 120 || (flightDays >= 40 && isActive && relevanceScore > 0)) grade = 'Top Scaler (High Spend)';
    else if (rankScore >= 70 || (flightDays >= 20 && isActive && relevanceScore > 0)) grade = 'Proven Winner';
    else if (rankScore >= 35) grade = 'Active Tester';
    else grade = 'Standard';

    // Countries served
    const countries = ad.languages && ad.languages.length > 0 ? ad.languages : targetCountries;

    rankedItems.push({
      id: ad.id,
      pageId: ad.page_id,
      pageName: ad.page_name || 'Advertiser',
      adSnapshotUrl: ad.ad_snapshot_url,
      adLibraryUrl: `https://www.facebook.com/ads/library/?id=${ad.id}`,
      variantCount: group.variantCount,
      associatedAdIds: group.allAdIds,
      stats: {
        isActive,
        flightDays,
        flightSummary,
        startDate: startFormatted,
        endDate: endFormatted,
        scaleTier,
        euReach,
        countries,
        platforms: ad.publisher_platforms || ['facebook', 'instagram'],
      },
      copy: {
        headline,
        body,
        caption,
        primaryHook,
        triggers,
      },
      ranking: {
        score: rankScore,
        grade,
        relevanceType,
      },
      discoveryVectors: ad.discoveryVectors || ['KEYWORD'],
      matchedQueries: ad.matchedQueries || [],
      media: null, // populated on demand by sniffer
    });
  }

  // Sort descending by rank score (Impressions + Longevity)
  rankedItems.sort((a, b) => b.ranking.score - a.ranking.score);

  return rankedItems;
}

/**
 * Paginate ranked items
 */
function paginateAds(rankedItems, page = 1, pageSize = 10) {
  const totalItems = rankedItems.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    hasPrevPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
    items: rankedItems.slice(startIndex, endIndex),
  };
}

module.exports = {
  deduplicateAndRankAds,
  paginateAds,
  classifyHook,
};
