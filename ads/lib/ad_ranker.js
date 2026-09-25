/**
 * Ad Deduplication & Dual-Metric Ranking Engine
 * Ascendant Labs / Agentic Meta Ad Search Engine
 * 
 * Deduplicates identical creatives across ad sets, computes performance scores
 * based on impressions and active longevity, and structures ad stats.
 */

const crypto = require('crypto');
const { assetFingerprint } = require('./media_resolver');

function countryCodes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => {
    const raw = typeof value === 'string' ? value
      : value && typeof value === 'object'
        ? (value.country_code || value.countryCode || value.country || value.code)
        : null;
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    return /^[A-Z]{2}$/.test(code) && code !== 'EN' && code !== 'ZZ' ? code : null;
  }).filter(Boolean))].sort();
}

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
  if (/^(?:meta\s+)?ad\s+library$|^see\s+summary\s+details$|^estimated\s+audience\s+size:?$|^amount\s+spent(?:\s*\([^)]*\))?:?$|^categories$|^impressions:?$|^see\s+more$|^log\s*in$|^log\s*out$|^sign\s*up$|^search\s+ads$|^filter\s+results$/i.test(s)) return '';
  if (/^this ad was run by an account or page we later disabled/i.test(s)) return '';
  if (/^sorry, we're having trouble playing this video\.?$/i.test(s)) return '';
  if (/^(?:Started\s+running\s+on\s+|Library\s+ID:\s*)\d+/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*[-–—~to\s]+(?:\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|present)$/i.test(s)) return '';
  if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—~to\s]+(?:\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|present)$/i.test(s)) return '';
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}\s*[-–—~to\s]+\s*\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

const REMOVED_AD_PATTERN = /(?:account or page (?:we )?later disabled|not following our advertising standards|this ad was run by an account or page|this ad (?:was|has been) (?:taken down|removed)|ad is no longer available|this ad was taken down|this ad may have expired, or the page may have been deleted|we couldn't find this ad|this content isn't available right now)/i;

function isRemovedOrDisabledAd(ad) {
  if (!ad) return true;
  if (ad.isRemoved) return true;
  if (ad.media?.status === 'removed' || ad.media?.isRemoved) return true;
  if (ad.browserMedia?.status === 'removed' || ad.browserMedia?.isRemoved) return true;
  const texts = [
    ad.page_name,
    ...(ad.ad_creative_bodies || []),
    ...(ad.ad_creative_link_titles || []),
    ...(ad.ad_creative_link_descriptions || []),
    ...(ad.ad_creative_link_captions || []),
    ad.body,
    ad.headline,
  ].filter(Boolean);
  return texts.some(t => REMOVED_AD_PATTERN.test(typeof t === 'string' ? t : JSON.stringify(t)));
}

/**
 * Deduplicate and Rank Raw Ad Records
 */
function deduplicateAndRankAds(rawAds, options = {}) {

  // 1. Group by creative fingerprint to collapse identical creatives
  const creativeGroups = new Map();

  for (const ad of rawAds) {
    if (!ad || isRemovedOrDisabledAd(ad)) continue;
    if (/^(?:log\s*in|log\s*out|meta\s+ad\s+library|ad\s+library)$/i.test(String(ad.page_name || '').trim())) continue;
    const bodies = (ad.ad_creative_bodies || []).map(cleanAdText).filter(Boolean);
    const titles = (ad.ad_creative_link_titles || []).map(cleanAdText).filter(Boolean);
    const descriptions = (ad.ad_creative_link_descriptions || []).map(cleanAdText).filter(Boolean);
    const captions = (ad.ad_creative_link_captions || []).map(cleanAdText).filter(Boolean);
    const body = bodies[0] || '';
    const title = titles[0] || '';
    const description = descriptions[0] || '';
    const caption = captions[0] || '';
    const media = ad.browserMedia || {};
    const creatives = media.creatives?.length ? media.creatives : [media];
    const asset = [...new Set(creatives.map(item => {
      const video = assetFingerprint(item.videoUrl || item.videoSources?.[0]);
      const image = assetFingerprint(item.thumbnailUrl || item.imageSources?.[0]);
      return video ? `video:${video}` : image ? `image:${image}` : '';
    }).filter(Boolean))].sort().join('|');

    // The asset identifies a visual creative even when copy changes. Without
    // media, require actual ad copy; a shared destination alone is ambiguous.
    const normText = (asset ? [asset] : (body || title || description) ? [body, title, description, caption] : [])
      .map(value => String(value).toLowerCase().replace(/\s+/g, ' ').trim()).join(':::');
    const hash = crypto.createHash('md5').update(normText || `ad:${ad.id}`).digest('hex');

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
            platforms: a.publisher_platforms || [],
          });
        }
      }
    }

    // Flight Timeline
    const startDateRaw = ad.ad_delivery_start_time || ad.ad_creation_time;
    const endDateRaw = ad.ad_delivery_stop_time || null;
    const startMs = startDateRaw ? new Date(startDateRaw).getTime() : now;
    const endMs = endDateRaw ? new Date(endDateRaw).getTime() : now;

    const isActive = !endDateRaw || endMs > now;
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

    const combinedContent = `${ad.page_name || ''} ${headline} ${body} ${caption}`.toLowerCase();

    // Strict Relevance Matching against Target Context
    const targetBrand = (options.targetBrand || '').toLowerCase().trim();
    const coreKeywords = (options.coreKeywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
    const targetDomain = (options.targetDomain || '').toLowerCase().trim();
    const rawQuery = (options.searchQuery || '').toLowerCase().trim();

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

    let queryInPageOrCopy = false;
    if (rawQuery && rawQuery.length >= 2) {
      const qEscaped = rawQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const qRegex = new RegExp(`\\b${qEscaped}\\b`, 'i');
      queryInPageOrCopy = qRegex.test(combinedContent) || !!(ad.page_name && qRegex.test(ad.page_name));
    }

    let keywordMatches = 0;
    for (const kw of meaningfulKeywords) {
      const kwRegex = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (kwRegex.test(combinedContent)) {
        keywordMatches++;
      }
    }

    const queryTokens = (rawQuery ? rawQuery.split(/[^a-z0-9]+/i) : []).filter(t => t.length >= 2 && !stopWords.has(t));
    const brandTokens = (targetBrand ? targetBrand.split(/[^a-z0-9]+/i) : []).filter(t => t.length >= 2 && !stopWords.has(t));
    const allTokens = [...new Set([...queryTokens, ...brandTokens])];
    let tokenMatches = 0;
    for (const tok of allTokens) {
      const tokRegex = new RegExp(`\\b${tok.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (tokRegex.test(combinedContent)) {
        tokenMatches++;
      }
    }

    const isReviewAdvertorial = /\b(review|reviewed|vs|tested|ratings?|top \d|best \d|scam|legit|hands-on|discount code|promo code|coupon|worth it)\b/i.test(combinedContent);
    const isBrandEquivalentQuery = Boolean(rawQuery && targetBrand &&
      rawQuery.trim().toLowerCase() === targetBrand.trim().toLowerCase());

    if (brandInPage) {
      relevanceType = 'OFFICIAL_BRAND';
      relevanceScore = 100;
    } else if (brandInCopy || domainMatched || (queryInPageOrCopy && isBrandEquivalentQuery)) {
      if (isReviewAdvertorial) {
        relevanceType = 'REVIEW_EDITORIAL';
        relevanceScore = 90;
      } else {
        relevanceType = 'AFFILIATE_PARTNER';
        relevanceScore = 85;
      }
    } else if (queryInPageOrCopy) {
      relevanceType = 'RELATED_OFFER';
      relevanceScore = 80;
    } else if (keywordMatches > 0 || (allTokens.length > 0 && tokenMatches >= Math.min(2, allTokens.length))) {
      relevanceType = 'RELATED_OFFER';
      relevanceScore = 70;
    } else if (tokenMatches > 0) {
      relevanceType = 'RELATED_OFFER';
      relevanceScore = 60;
    } else {
      const hasSubstance = Boolean(body || headline || ad.browserMedia?.creatives?.length || ad.browserMedia?.thumbnailUrl || ad.browserMedia?.videoUrl);
      if (hasSubstance) {
        relevanceType = 'DISCOVERED';
        relevanceScore = 45;
      } else {
        continue;
      }
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

    // The search country is a filter, not evidence of this ad's delivery or targeting.
    const reached = countryCodes(group.allAds.flatMap(item => [
      ...(Array.isArray(item.reached_countries) ? item.reached_countries : []),
      ...(Array.isArray(item.age_country_gender_reach_breakdown) ? item.age_country_gender_reach_breakdown : []),
    ]));
    const targetingLocations = group.allAds.flatMap(item => [
      ...(Array.isArray(item.target_countries) ? item.target_countries : []),
      ...(Array.isArray(item.target_locations) ? item.target_locations : []),
    ]);
    const isExcluded = location => location && typeof location === 'object'
      && (location.excluded === true || location.is_excluded === true
        || String(location.included_or_excluded || location.includedOrExcluded || '').toLowerCase() === 'excluded');
    const targeted = countryCodes(targetingLocations.filter(location => !isExcluded(location)));
    const excluded = countryCodes(targetingLocations.filter(isExcluded));
    const listed = countryCodes(group.allAds.flatMap(item =>
      Array.isArray(item.targeted_or_reached_countries) ? item.targeted_or_reached_countries : []));
    const countryBasis = reached.length ? 'reached' : targeted.length ? 'targeted' : listed.length ? 'listed' : 'unknown';
    const countries = reached.length ? reached : targeted.length ? targeted : listed;
    const languages = Array.isArray(ad.languages) ? ad.languages : [];

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
      page_name: ad.page_name || 'Advertiser',
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
        startDate: ad.ad_delivery_start_time ? startFormatted : null,
        endDate: endFormatted,
        scaleTier,
        impressionTier: scaleTier,
        euReach,
        euTotalReach: euReach,
        impressions: ad.impressions || null,
        spend: ad.spend || null,
        languages: languages,
        countries,
        countryBasis,
        reachedCountries: reached,
        targetedCountries: targeted,
        excludedCountries: excluded,
        listedCountries: listed,
        platforms: ad.publisher_platforms || [],
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
        rankScore,
        finalScore: rankScore,
        grade,
        relevanceType,
        relevanceScore,
        relationship: relevanceType,
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

function isPresentableAd(ad) {
  if (!ad || isRemovedOrDisabledAd(ad)) return false;
  const type = ad?.ranking?.relevanceType;
  const score = Number(ad?.ranking?.relevanceScore);
  // DISCOVERED is the fail-open score when the AI judge did not evaluate a
  // card. Keep those candidates in retrieval diagnostics, not user results.
  // Evaluated related offers and category solutions (score >= 30) are retained
  // so we don't miss potential ads to rank.
  return type !== 'UNRELATED' && type !== 'DISCOVERED'
    && (!Number.isFinite(score) || score >= 30);
}

module.exports = {
  deduplicateAndRankAds,
  paginateAds,
  classifyHook,
  isPresentableAd,
  isRemovedOrDisabledAd,
};
