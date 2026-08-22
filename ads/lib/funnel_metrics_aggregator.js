/**
 * Funnel Metrics Aggregator & Objection Classifier for CTWA Loop
 * Ascendant Labs / ScaleDM
 */

/**
 * Classifies a conversation transcript into an objection / drop-off bucket
 */
function classifyConversation(convo) {
  const msgs = convo.messages || [];
  if (msgs.length === 0) return { category: 'EMPTY_CHAT', reason: 'No messages recorded' };

  const allText = msgs.map((m) => (m.text || '').toLowerCase()).join(' ');
  const userMsgs = msgs.filter((m) => m.sender === 'user');
  const agentMsgs = msgs.filter((m) => m.sender === 'agent');

  // 1. Converted / High Intent CTA Engaged
  if (convo.offerCtaSent || allText.includes('nordvpn.net') || allText.includes('protonvpn.com')) {
    if (userMsgs.some((m) => /thank|got it|bought|downloaded|installed|done|signed up|ok/i.test(m.text || ''))) {
      return { category: 'CONVERTED_HIGH_INTENT', reason: 'User engaged with CTA and indicated completion' };
    }
    return { category: 'CTA_SENT_PENDING', reason: 'Received product card, pending affiliate verification' };
  }

  // 2. Ghosted immediately after initial icebreaker
  if (userMsgs.length <= 1 && agentMsgs.length <= 1) {
    return { category: 'ABANDONED_AT_GREETING', reason: 'User sent opener but dropped after first agent response' };
  }

  // 3. Price or Free Objection
  if (
    /free|cost|price|subscription|pay|cheap|money|charge|dollar|pound|expensive|\$|£/i.test(allText)
  ) {
    return { category: 'PRICE_OBJECTION', reason: 'User inquired about pricing or sought free alternatives' };
  }

  // 4. Scan Resistance
  if (
    /why scan|don't want to scan|no scan|refuse|scam|safe to click|link safe|why click/i.test(allText)
  ) {
    return { category: 'SCAN_RESISTANCE', reason: 'User expressed hesitancy or skepticism toward running connection scan' };
  }

  // 5. Competitor inquiry
  if (
    /expressvpn|surfshark|mullvad|cyberghost|windscribe|tunnelbear|ipvanish|private internet access|pia/i.test(allText)
  ) {
    return { category: 'COMPETITOR_INQUIRY', reason: 'User asked about or compared with other VPN providers' };
  }

  // 6. Technical Confusion
  if (
    /what is a vpn|how does it work|is it antivirus|do i need this|virus|antivirus|hacked/i.test(allText)
  ) {
    return { category: 'TECH_CONFUSION', reason: 'User is a beginner needing fundamental education on VPN protection' };
  }

  // 7. Non-English or Foreign Language
  if (
    /[\u0600-\u06FF\u0400-\u04FF\u4e00-\u9fa5\u0900-\u097F]/.test(allText) &&
    !userMsgs.some((m) => /yes|no|hi|hello/i.test(m.text || ''))
  ) {
    return { category: 'NON_ENGLISH_CHAT', reason: 'Conversation occurred in non-English language' };
  }

  // 8. General Dropoff
  if (convo.lastSender === 'agent') {
    return { category: 'GHOSTED_MID_DISCOVERY', reason: 'User stopped responding during SPIN discovery dialogue' };
  }

  return { category: 'IN_PROGRESS', reason: 'Active or unclassified conversation flow' };
}

/**
 * Aggregates Meta Ad insights with Firestore chat transcripts
 */
function aggregateFunnelData(metaResults, conversations) {
  const adsMap = metaResults.adsMap || {};
  const campaigns = metaResults.campaigns || [];

  // Group conversations by adId
  const convsByAd = {};
  const untrackedConvs = [];

  conversations.forEach((convo) => {
    const classification = classifyConversation(convo);
    convo.classification = classification;

    if (convo.adId && adsMap[convo.adId]) {
      if (!convsByAd[convo.adId]) convsByAd[convo.adId] = [];
      convsByAd[convo.adId].push(convo);
    } else {
      untrackedConvs.push(convo);
    }
  });

  const variantsAnalysis = [];
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalLinkClicks = 0;
  let totalMetaConvs = 0;
  let totalFirestoreConvs = 0; // Strictly attributed to target CTWA ads
  let totalScans = 0;
  let totalCtaSent = 0;
  let totalPurchases = 0;

  const objectionCounts = {};

  // Process mapped ads
  Object.values(adsMap).forEach((ad) => {
    const adConvs = convsByAd[ad.adId] || [];
    const scanCount = adConvs.filter((c) => c.scanTriggered).length;
    const ctaCount = adConvs.filter((c) => c.offerCtaSent).length;
    const avgTurns =
      adConvs.length > 0
        ? (adConvs.reduce((acc, c) => acc + c.messageCount, 0) / adConvs.length).toFixed(1)
        : 0;

    const adObjections = {};
    const startersCount = {};
    const journeys = [];

    adConvs.forEach((c) => {
      const cat = c.classification.category;
      adObjections[cat] = (adObjections[cat] || 0) + 1;
      objectionCounts[cat] = (objectionCounts[cat] || 0) + 1;

      const starterText = c.conversationStarter || c.initialUserMsg || 'N/A';
      startersCount[starterText] = (startersCount[starterText] || 0) + 1;

      if (c.journey) {
        journeys.push({
          waId: c.waId ? '***' + String(c.waId).slice(-4) : 'unknown',
          dropOffStage: c.journey.dropOffStage,
          starter: c.journey.conversationStarter,
          starterType: c.journey.starterType,
          totalSteps: c.journey.totalSteps,
          scanCompleted: c.journey.scanCompleted,
          scanData: c.scanData,
          reachedOfferCard: c.journey.reachedOfferCard,
          steps: c.journey.steps,
        });
      }
    });

    totalSpend += ad.spend;
    totalImpressions += ad.impressions;
    totalClicks += ad.clicks;
    totalLinkClicks += ad.linkClicks;
    totalMetaConvs += ad.convsStarted;
    totalFirestoreConvs += adConvs.length;
    totalScans += scanCount;
    totalCtaSent += ctaCount;
    totalPurchases += ad.purchases;

    // Funnel rates
    const clickToChatRate = ad.linkClicks > 0 ? ((adConvs.length / ad.linkClicks) * 100).toFixed(1) : '0.0';
    const chatToScanRate = adConvs.length > 0 ? ((scanCount / adConvs.length) * 100).toFixed(1) : '0.0';
    const scanToCtaRate = scanCount > 0 ? ((ctaCount / scanCount) * 100).toFixed(1) : '0.0';
    const chatToCtaRate = adConvs.length > 0 ? ((ctaCount / adConvs.length) * 100).toFixed(1) : '0.0';

    variantsAnalysis.push({
      adId: ad.adId,
      adName: ad.adName,
      status: ad.status,
      spend: ad.spend,
      impressions: ad.impressions,
      clicks: ad.clicks,
      linkClicks: ad.linkClicks,
      ctr: ad.ctr,
      cpc: ad.cpc,
      metaConvsStarted: ad.convsStarted,
      costPerConvStarted: ad.costPerConvStarted || (ad.convsStarted > 0 ? ad.spend / ad.convsStarted : 0),
      configuredStarter: ad.creative ? ad.creative.conversationStarter : '',
      configuredIcebreakers: ad.creative ? ad.creative.icebreakers : [],
      startersBreakdown: startersCount,
      firestoreChats: adConvs.length,
      scansTriggered: scanCount,
      ctaCardsSent: ctaCount,
      purchases: ad.purchases,
      avgTurns: parseFloat(avgTurns),
      funnelRates: {
        clickToChatRate: parseFloat(clickToChatRate),
        chatToScanRate: parseFloat(chatToScanRate),
        scanToCtaRate: parseFloat(scanToCtaRate),
        chatToCtaRate: parseFloat(chatToCtaRate),
      },
      objections: adObjections,
      creative: ad.creative,
      journeys,
      sampleConversations: adConvs.slice(0, 3),
    });
  });

  return {
    summary: {
      totalSpend: parseFloat(totalSpend.toFixed(2)),
      totalImpressions,
      totalClicks,
      totalLinkClicks,
      totalMetaConvs,
      totalFirestoreConvs,
      totalScans,
      totalCtaSent,
      totalPurchases,
      overallCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00',
      overallCpc: totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : '0.00',
      overallCostPerChat: totalFirestoreConvs > 0 ? (totalSpend / totalFirestoreConvs).toFixed(2) : '0.00',
      overallCostPerScan: totalScans > 0 ? (totalSpend / totalScans).toFixed(2) : '0.00',
      overallCostPerCta: totalCtaSent > 0 ? (totalSpend / totalCtaSent).toFixed(2) : '0.00',
    },
    objectionTaxonomy: objectionCounts,
    variants: variantsAnalysis,
    unmatchedCount: untrackedConvs.length,
    unmatchedSample: untrackedConvs.slice(0, 3),
  };
}

module.exports = {
  classifyConversation,
  aggregateFunnelData,
};
