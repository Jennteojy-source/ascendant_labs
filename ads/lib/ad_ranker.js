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

function cleanAdText(text) {
  if (!text || typeof text !== 'string') return '';
  const s = text.trim();
  if (s.length === 0) return '';
  if (/^\{\{[^}]+\}\}$/.test(s) || /\{\{product\./i.test(s)) return '';
  if (/^(?:null|undefined|none|n\/a|\{\}|\[\])$/i.test(s)) return '';
  if (/\b\d+\s+ads?\s+use\s+this\s+creative/i.test(s)) return '';
  if (/\b(?:EU\s+)?transparency\b/i.test(s) && s.length < 40) return '';
  if (/^(?:active|inactive|sponsored|report\s+ad|see\s+ad\s+details|about\s+the\s+advertiser|this\s+ad\s+has\s+multiple\s+versions|multiple\s+versions)$/i.test(s)) return '';
  if (/^(?:Started\s+running\s+on\s+|Library\s+ID:\s*)\d+/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*[-–—~to\s]+(?:\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|present)$/i.test(s)) return '';
  if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—~to\s]+(?:\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|present)$/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}\s*[-–—~to\s]+\s*\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

/**
 * Deduplicate and Rank Raw Ad Records
 */
function deduplicateAndRankAds(rawAds, options = {}) {
  const targetCountries = options.countries || ['US'];

  // 1. Group by creative fingerprint to collapse identical creatives
  const creativeGroups = new Map();

  for (const ad of rawAds) {
    const bodies = (ad.ad_creative_bodies || []).map(cleanAdText).filter(Boolean);
    const titles = (ad.ad_creative_link_titles || []).map(cleanAdText).filter(Boolean);
    const descriptions = (ad.ad_creative_link_descriptions || []).map(cleanAdText).filter(Boolean);
    const captions = (ad.ad_creative_link_captions || []).map(cleanAdText).filter(Boolean);
    const body = bodies[0] || '';
    const title = titles[0] || '';
    const description = descriptions[0] || '';
    const caption = captions[0] || '';
    const media = ad.browserMedia || {};
    const asset = [media.videoUrl, media.thumbnailUrl, ...(media.creatives || []).flatMap(item => [item.videoUrl, item.thumbnailUrl])]
      .filter(Boolean).map(value => String(value).split('?')[0]).sort().join('|');

    // A creative is defined by its rendered copy and asset, not its ad set or
    // advertiser page. This collapses repeated Ads Library entries reliably.
    const normText = [body, title, description, caption, asset]
      .map(value => String(value).toLowerCase().replace(/\s+/g, ' ').trim()).join(':::');
    const hash = crypto.createHash('md5').update(normText).digest('hex');

    if (!creativeGroups.has(hash)) {
      creativeGroups.set(hash, {
        primaryAd: ad,
        allAdIds: [ad.id],
        variantCount: 1,
        allAds: [ad],
      });
    } else {
      const group = creativeGroups.get(hash);
      group.allAdIds.push(ad.id);
      group.allAds.push(ad);
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

    // Compile all unique creative variants across group ads
    const variants = [];
    const seenCopy = new Set();
    for (const a of group.allAds) {
      const bodies = (a.ad_creative_bodies || []).map(cleanAdText).filter(Boolean);
      const titles = (a.ad_creative_link_titles || []).map(cleanAdText).filter(Boolean);
      const descriptions = (a.ad_creative_link_descriptions || []).map(cleanAdText).filter(Boolean);
      const captions = (a.ad_creative_link_captions || []).map(cleanAdText).filter(Boolean);
      const safeBodies = bodies.length > 0 ? bodies : [''];
      const safeTitles = titles.length > 0 ? titles : [''];
      const safeDescriptions = descriptions.length > 0 ? descriptions : [''];
      const safeCaptions = captions.length > 0 ? captions : [''];

      const maxCombos = Math.max(safeBodies.length, safeTitles.length, safeDescriptions.length, safeCaptions.length);
      for (let i = 0; i < maxCombos; i++) {
        const vBody = safeBodies[i] || safeBodies[0] || '';
        const vTitle = safeTitles[i] || safeTitles[0] || '';
        const vDesc = safeDescriptions[i] || safeDescriptions[0] || '';
        const vCap = safeCaptions[i] || safeCaptions[0] || '';

        const hasAnyContent = Boolean(vTitle || vBody || vDesc || vCap);
        if (!hasAnyContent && variants.length > 0) continue;
        const vKey = `${vTitle}:::${vBody.slice(0, 100)}:::${vDesc.slice(0, 100)}`;
        if (!seenCopy.has(vKey)) {
          seenCopy.add(vKey);
          variants.push({
            id: a.id,
            index: variants.length + 1,
            headline: vTitle,
            body: vBody,
            description: vDesc,
            caption: vCap,
            startDate: a.ad_delivery_start_time ? new Date(a.ad_delivery_start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
            endDate: a.ad_delivery_stop_time ? new Date(a.ad_delivery_stop_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present',
            euTotalReach: a.eu_total_reach ? Number(a.eu_total_reach) : null,
            platforms: a.publisher_platforms || ['facebook', 'instagram'],
          });
        }
      }
    }

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
    let scaleTier = 'Low Impression';
    let impressionScore = 10;

    if ((euReach && euReach >= 10000) || flightDays >= 21 || group.variantCount >= 4) {
      scaleTier = 'High Impression';
      impressionScore = 150;
    } else if ((euReach && euReach >= 2000) || flightDays >= 7) {
      scaleTier = 'Moderate Scale';
      impressionScore = 60;
    } else {
      scaleTier = 'Low Impression';
      impressionScore = 10;
    }

    // Copy and Hook Classification
    const bodies = (ad.ad_creative_bodies || []).map(cleanAdText).filter(Boolean);
    const titles = (ad.ad_creative_link_titles || []).map(cleanAdText).filter(Boolean);
    const captions = (ad.ad_creative_link_captions || []).map(cleanAdText).filter(Boolean);
    const descriptions = (ad.ad_creative_link_descriptions || []).map(cleanAdText).filter(Boolean);
    const body = bodies[0] || '';
    const headline = titles[0] || '';
    const caption = captions[0] || '';
    const description = descriptions[0] || '';
    const { primaryHook, triggers } = classifyHook(body, headline);
    const copyScore = Math.min(20, triggers.length * 5);

    // Spam / Unrelated Content Filter (Hard Disqualify)
    const combinedContent = `${ad.page_name || ''} ${headline} ${body} ${caption}`.toLowerCase();
    const isRomanceSpam = /\b(novel|novels|chapter|chapters|billionaire|ceo|divorce|alpha male|werewolf|pregnant|forced to marry|manga|comic|webtoon|slots|casino|horoscope|zodiac|tarot|credit card|payday loan|dramas? cortos?|dramas? curtos?|short drama|reelshort|dramabox)\b/i.test(combinedContent);
    if (isRomanceSpam) {
      // Disqualify fiction, romance webnovels, short dramas, casino, and junk apps completely
      continue;
    }

    // Strict Relevance Matching against Target Context
    const targetBrand = (options.targetBrand || '').toLowerCase().trim();
    const coreKeywords = (options.coreKeywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
    const targetDomain = (options.targetDomain || '').toLowerCase().trim();

    const stopWords = new Set(['the', 'and', 'for', 'with', 'best', 'review', 'free', 'online', 'pro', 'official', 'new', 'top', 'vpn', 'app']);
    const meaningfulKeywords = coreKeywords.filter(k => k.length >= 1 && !stopWords.has(k));

    let relevanceType = 'UNRELATED';
    let relevanceScore = 0;

    let brandInPage = false;
    let brandInCopy = false;

    if (targetBrand && targetBrand.length >= 1) {
      const escaped = targetBrand.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const brandRegex = new RegExp(`\\b${escaped}\\b`, 'i');
      brandInPage = !!(ad.page_name && brandRegex.test(ad.page_name));
      brandInCopy = brandRegex.test(combinedContent);
    }
    const domainMatched = targetDomain && targetDomain.length > 2 && combinedContent.includes(targetDomain);

    let keywordMatches = 0;
    for (const kw of meaningfulKeywords) {
      const kwRegex = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (kwRegex.test(combinedContent)) {
        keywordMatches++;
      }
    }

    const isReviewAdvertorial = /\b(review|reviewed|vs|tested|ratings?|top \d|best \d|scam|legit|hands-on|discount code|promo code|coupon|worth it)\b/i.test(combinedContent);

    if (brandInPage) {
      relevanceType = 'OFFICIAL_BRAND';
      relevanceScore = 100;
    } else if (brandInCopy || domainMatched) {
      if (isReviewAdvertorial) {
        relevanceType = 'REVIEW_EDITORIAL';
        relevanceScore = 90;
      } else {
        relevanceType = 'AFFILIATE_PARTNER';
        relevanceScore = 85;
      }
    } else {
      // Discard unrelated ads completely
      relevanceType = 'UNRELATED';
      relevanceScore = 0;
      continue;
    }

    // Dual-Metric Ranking Formula:
    // Active ads get top priority (+500 points).
    // High impression & scale gets up to +150 points.
    // Longevity adds up to +150 points.
    // Result: Active high-impression winning ads dominate top ranks.
    const activeBonus = isActive ? 500 : 0;
    const flightScore = Math.min(150, flightDays * 3.5);
    const variantBonus = Math.min(40, (group.variantCount - 1) * 8);
    const rawRankScore = activeBonus + impressionScore + flightScore + copyScore + variantBonus + (relevanceScore * 2);
    const rankScore = Math.max(0, Math.round(rawRankScore));

    // Grade assignment
    let grade = 'C';
    if (rankScore >= 500 && scaleTier === 'High Impression') grade = 'Top Scaler (High Impression)';
    else if (rankScore >= 500) grade = 'Active Winner';
    else if (isActive) grade = 'Active Tester';
    else grade = 'Ended';

    // Countries served: strictly use target countries or ad's target locations, NOT language
    let countries = Array.isArray(targetCountries) && targetCountries.length > 0 ? targetCountries : ['US', 'GB', 'CA', 'AU'];
    if (Array.isArray(ad.target_locations) && ad.target_locations.length > 0) {
      countries = ad.target_locations.map(l => l.country_code || l.name || l).filter(Boolean);
    } else if (Array.isArray(ad.target_countries) && ad.target_countries.length > 0) {
      countries = ad.target_countries;
    }
    const languages = Array.isArray(ad.languages) && ad.languages.length > 0 ? ad.languages : ['en'];

    // Baseline destination URL & display domain extraction
    let displayDomain = caption || '';
    let destinationUrl = '';
    
    if (caption) {
      if (/^https?:\/\//i.test(caption)) {
        destinationUrl = caption;
        try { displayDomain = new URL(caption).hostname.replace(/^www\./, ''); } catch (e) {}
      } else if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(caption)) {
        destinationUrl = `https://${caption.trim()}`;
        displayDomain = caption.split('/')[0].trim().replace(/^www\./, '');
      }
    }
    
    // Fallback: check body copy for full URLs
    if (!destinationUrl && body) {
      const urlMatch = body.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        destinationUrl = urlMatch[0];
        try { displayDomain = new URL(destinationUrl).hostname.replace(/^www\./, ''); } catch (e) {}
      }
    }

    const ctaText = 'Learn More';

    rankedItems.push({
      id: ad.id,
      pageId: ad.page_id,
      pageName: ad.page_name || 'Advertiser',
      adLibraryUrl: `https://www.facebook.com/ads/library/?id=${ad.id}`,
      adSnapshotUrl: ad.ad_snapshot_url || null,
      destinationUrl,
      displayDomain,
      ctaText,
      variantCount: Math.max(group.variantCount, variants.length),
      variants,
      associatedAdIds: group.allAdIds,
      stats: {
        isActive,
        flightDays,
        flightSummary,
        startDate: startFormatted,
        endDate: endFormatted,
        scaleTier,
        impressionTier: scaleTier,
        euReach,
        euTotalReach: euReach,
        impressions: ad.impressions || null,
        spend: ad.spend || null,
        languages: languages,
        countries,
        platforms: ad.publisher_platforms || ['facebook', 'instagram'],
      },
      copy: {
        headline,
        body,
        caption,
        description,
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
      media: ad.browserMedia || null, // browser discovery may already include fresh creative media
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
