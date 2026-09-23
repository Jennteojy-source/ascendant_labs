/** Competitor research backed by the public Ads Library browser collector. */
const { queryMetaArchive } = require('./comparable_finder');

function classifyHookArchetype(text = '') {
  const lower = text.toLowerCase();
  if (/\b(stop|don't|never|mistake|worst|warning|avoid)\b/i.test(lower)) return 'Negative Friction / Warning Pattern Interrupt';
  if (/\b(secret|nobody tells you|didn't know|hidden|truth|why)\b/i.test(lower)) return 'Curiosity Gap / Hidden Secret Hook';
  if (/\b(my husband|i tried|after 30 days|i was skeptical|finally)\b/i.test(lower)) return 'Authentic UGC Personal Story / Relatable Struggle';
  if (/\b(vs|alternative|compared to|switch|better than|ditch)\b/i.test(lower)) return 'Direct Comparison / Superior Alternative Hook';
  if (/\b(hack|10 seconds|one tap|routine|habit|morning)\b/i.test(lower)) return 'Quick Daily Habit / Effortless Routine Hook';
  return 'Direct Value & Problem-Solution Hook';
}

async function researchCompetitorMetaAds(brandName, searchKeywords = [], options = {}) {
  const countries = options.countries || ['US', 'GB', 'CA', 'AU'];
  const limitPerTerm = options.limitPerTerm || 30;
  const adsMap = new Map();
  const terms = [...new Set([brandName, ...searchKeywords].map(value => String(value || '').trim()).filter(Boolean))].slice(0, 6);
  console.log(`\nBrowser research: ${terms.join(', ')} (${countries.join(', ')})`);
  for (const term of terms) {
    const result = await queryMetaArchive(term, { countries, status: 'ALL', limit: limitPerTerm, mediaType: 'ALL' });
    if (result.error && !result.data.length) console.warn(`  [Browser notice] ${term}: ${result.error}`);
    for (const ad of result.data) if (ad?.id && !adsMap.has(ad.id)) adsMap.set(ad.id, ad);
    console.log(`  "${term}" -> ${result.data.length} ads`);
  }
  const evaluatedAds = [...adsMap.values()].map(ad => {
    const body = (ad.ad_creative_bodies || [])[0] || '';
    const headline = (ad.ad_creative_link_titles || [])[0] || '';
    const caption = (ad.ad_creative_link_captions || [])[0] || '';
    const start = new Date(ad.ad_delivery_start_time || ad.ad_creation_time || Date.now());
    const stop = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : new Date();
    const flightDays = Math.max(1, Math.round((stop - start) / 86400000));
    const isActive = !ad.ad_delivery_stop_time;
    const openingHookText = body.split(/(?<=[.?!])\s+/).filter(Boolean).slice(0, 2).join(' ') || headline || 'Check this out';
    let winningScore = 20 + (flightDays >= 21 ? 50 : flightDays >= 14 ? 40 : flightDays >= 7 ? 25 : 0);
    if (isActive) winningScore += 15;
    if (Number(ad.eu_total_reach) > 1000) winningScore += 15;
    return { id: ad.id, pageName: ad.page_name, isActive, flightDays,
      startDate: ad.ad_delivery_start_time, platforms: ad.publisher_platforms || [], headline, caption, body,
      openingHookText, hookArchetype: classifyHookArchetype(openingHookText), winningScore,
      adLibraryUrl: `https://www.facebook.com/ads/library/?id=${ad.id}`, media: ad.browserMedia || null };
  }).sort((a, b) => b.winningScore - a.winningScore);
  const topHooks = evaluatedAds.slice(0, 8).map((ad, index) => ({ rank: index + 1,
    pageName: ad.pageName, flightDays: ad.flightDays, archetype: ad.hookArchetype,
    openingHook: ad.openingHookText, headline: ad.headline, winningScore: ad.winningScore,
    libraryUrl: ad.adLibraryUrl }));
  return { success: true, source: 'public-browser', totalAdsScanned: evaluatedAds.length,
    activeAdsCount: evaluatedAds.filter(ad => ad.isActive).length,
    topWinningAds: evaluatedAds.slice(0, 10), topHooks };
}

module.exports = { researchCompetitorMetaAds, classifyHookArchetype };
