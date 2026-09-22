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
      const bodies = a.ad_creative_bodies && a.ad_creative_bodies.length > 0 ? a.ad_creative_bodies : [''];
      const titles = a.ad_creative_link_titles && a.ad_creative_link_titles.length > 0 ? a.ad_creative_link_titles : [''];
      const descriptions = a.ad_creative_link_descriptions && a.ad_creative_link_descriptions.length > 0 ? a.ad_creative_link_descriptions : [''];
      const captions = a.ad_creative_link_captions && a.ad_creative_link_captions.length > 0 ? a.ad_creative_link_captions : [''];

      const maxCombos = Math.max(bodies.length, titles.length, descriptions.length, captions.length);
      for (let i = 0; i < maxCombos; i++) {
        const vBody = bodies[i] || bodies[0] || '';
        const vTitle = titles[i] || titles[0] || '';
        const vDesc = descriptions[i] || descriptions[0] || '';
        const vCap = captions[i] || captions[0] || '';

        const vKey = `${vTitle}:::${vBody.slice(0, 100)}`;
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
    const isRomanceSpam = /\b(novel|novels|chapter|chapters|billionaire|ceo|divorce|alpha male|werewolf|pregnant|forced to marry|manga|comic|webtoon|slots|casino|horoscope|zodiac|tarot|credit card|payday loan|dramas? cortos?|dramas? curtos?|short drama|reelshort|dramabox)\b/i.test(combinedContent);
    if (isRomanceSpam) {
      // Disqualify fiction, romance webnovels, short dramas, casino, and junk apps completely
      continue;
    }

    // Strict Relevance Matching against Target Context
    const targetBrand = (options.targetBrand || '').toLowerCase().trim();
    const coreKeywords = (options.coreKeywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
    const targetDomain = (options.targetDomain || '').toLowerCase().trim();

    const stopWords = new Set(['the', 'and', 'for', 'with', 'best', 'review', 'free', 'online', 'pro', 'official', 'new', 'top']);
    const meaningfulKeywords = coreKeywords.filter(k => k.length >= 1 && !stopWords.has(k));

    let relevanceType = 'UNRELATED';
    let relevanceScore = 5;

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
    } else if (keywordMatches >= 2) {
      relevanceType = 'RELATED_CREATIVE';
      relevanceScore = 35;
    } else {
      relevanceType = 'UNRELATED';
      relevanceScore = 0;
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
        euReach,
        euTotalReach: euReach,
        impressions: ad.impressions || null,
        spend: ad.spend || null,
        languages: ad.languages || ['en'],
        countries,
        platforms: ad.publisher_platforms || ['facebook', 'instagram'],
      },
      copy: {
        headline,
        body,
        caption,
        description: (ad.ad_creative_link_descriptions && ad.ad_creative_link_descriptions[0]) || '',
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
