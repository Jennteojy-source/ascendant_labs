/**
 * Multi-Layer LLM Evaluator for Ad x Meta Business AI WhatsApp Agent Loop
 * Ascendant Labs / ScaleDM
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function getActiveAgentCode() {
  const syncMbaPath = path.resolve(__dirname, '../../functions/scripts/sync_mba.js');
  if (fs.existsSync(syncMbaPath)) {
    return fs.readFileSync(syncMbaPath, 'utf8');
  }
  return '';
}

function getCreativePlaybook() {
  const playbookPath = path.resolve(__dirname, '../prompts/ctwa_funnel/ctwa_mba_master_playbook.md');
  if (fs.existsSync(playbookPath)) {
    return fs.readFileSync(playbookPath, 'utf8');
  }
  return '';
}

function callGemini(apiKey, promptText) {
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3000 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve(text);
          } catch (e) {
            reject(new Error(`Failed to parse Gemini response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function callOpenAI(apiKey, promptText) {
  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are the Chief AI Growth Engineer for Ascendant Labs, evaluating Meta CTWA Ads and WhatsApp Meta Business AI sales agent performance.',
      },
      { role: 'user', content: promptText },
    ],
    temperature: 0.2,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices?.[0]?.message?.content || '';
            resolve(text);
          } catch (e) {
            reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Built-in deterministic heuristic evaluation when no LLM API key is present
 */
function runHeuristicEvaluation(aggregatedData) {
  const s = aggregatedData.summary;
  const obj = aggregatedData.objectionTaxonomy;
  const variants = aggregatedData.variants;

  const topObjections = Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `- **${cat}**: ${count} conversation(s)`)
    .join('\n');

  let variantRows = '';
  variants.forEach((v) => {
    const spend = (v.spend || 0).toFixed(2);
    const ctr = (v.ctr || 0).toFixed(2);
    const costPerConv = (v.costPerConvStarted || 0).toFixed(2);
    const chatToScan = (v.funnelRates && v.funnelRates.chatToScanRate != null) ? v.funnelRates.chatToScanRate : 0;
    const chatToCta = (v.funnelRates && v.funnelRates.chatToCtaRate != null) ? v.funnelRates.chatToCtaRate : 0;
    variantRows += `### Variant: ${v.adName} (${v.adId})\n`;
    variantRows += `- **Spend**: ${spend} | **CTR**: ${ctr}% | **Cost/Conv**: ${costPerConv}\n`;
    variantRows += `- **Funnel**: ${v.linkClicks || 0} Clicks -> ${v.firestoreChats || 0} Chats -> ${v.scansTriggered || 0} Scans (${chatToScan}%) -> ${v.ctaCardsSent || 0} CTAs (${chatToCta}%)\n`;
    if (v.sampleConversations && v.sampleConversations.length > 0) {
      variantRows += `- **Sample Drop-off Reasons**: ${v.sampleConversations.map((c) => c.classification.reason).join('; ')}\n`;
    }
    variantRows += '\n';
  });

  return `## 🧠 Diagnostic Evaluation & Recommendations (Heuristic Analysis Engine)

### 1. 📈 Executive Funnel Health
- **Total Ad Spend**: $${s.totalSpend.toFixed(2)}
- **Total Recorded Chats**: ${s.totalFirestoreConvs} (Cost per Chat: $${s.overallCostPerChat})
- **Scan Engagement Rate**: ${s.totalFirestoreConvs > 0 ? ((s.totalScans / s.totalFirestoreConvs) * 100).toFixed(1) : 0}% of chats ran a connection scan.
- **Product Card Delivery Rate**: ${s.totalFirestoreConvs > 0 ? ((s.totalCtaSent / s.totalFirestoreConvs) * 100).toFixed(1) : 0}% received a tracked product card.

### 2. 🎯 Key Objection & Friction Breakdown
${topObjections || '- No objection bottlenecks recorded.'}

### 3. 🎨 Creative & Ad Copy Action Items
${
  variants.length > 0
    ? variants
        .map((v) => {
          if (v.ctr < 1.0) {
            return `- **${v.adName}**: Low CTR (${v.ctr.toFixed(2)}%). Refresh primary hook and increase text contrast on character card.`;
          } else if (v.funnelRates.chatToScanRate < 40) {
            return `- **${v.adName}**: Healthy CTR (${v.ctr.toFixed(2)}%) but low scan rate (${v.funnelRates.chatToScanRate}%). Ensure initial icebreaker explicitly promises a "5-second connection audit".`;
          } else {
            return `- **${v.adName}**: Strong engagement across funnel. Consider increasing budget allocation.`;
          }
        })
        .join('\n')
    : '- Run active ad spend to populate variant comparison.'
}

### 4. 🤖 Agent Prompt Optimization Guidance (sync_mba.js)
${
  (obj['ABANDONED_AT_GREETING'] || 0) > 0
    ? `- **Reduce Greeting Friction**: ${obj['ABANDONED_AT_GREETING']} user(s) bounced on turn 1. In \`sync_mba.js\`, make the initial message shorter (max 2 sentences) and emphasize that the scan is 100% free and automatic.\n`
    : ''
}${
    (obj['PRICE_OBJECTION'] || 0) > 0
      ? `- **Address Pricing Upfront**: Users inquired about costs. Ensure \`CORE_SKILL\` highlights the "30-day money-back risk-free trial" before sending the final product card.\n`
      : ''
  }${
    (obj['SCAN_RESISTANCE'] || 0) > 0
      ? `- **Soften Scan Gate**: Users showed skepticism toward scanning. Reinforce rule: *"Never require a scan before selling — if user hesitates, explain the risk directly and recommend NordVPN immediately."*\n`
      : ''
  }
### 5. 🚀 Action Checklist for Today
1. **Creative**: Check Top Performing Variant CTR and duplicate winning hooks into new character assets in \`ads/creatives/ctwa/\`.
2. **Agent Setup**: Test modified prompt with \`node functions/scripts/eval_mba.js\` then deploy via \`node functions/scripts/sync_mba.js\`.
3. **Budget**: Shift 15% budget toward the highest chat-to-CTA variant.`;
}

/**
 * Main evaluation entry point
 */
async function evaluateLoopPerformance(aggregatedData) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const agentCode = getActiveAgentCode();
  const playbook = getCreativePlaybook();

  const prompt = `You are the Principal AI Growth Engineer and Media Buyer for Ascendant Labs.
Review today's performance data joining Meta CTWA Ads with our Meta Business AI WhatsApp Agent transcripts and affiliate conversions.

---
### 1. SUMMARY PERFORMANCE DATA:
${JSON.stringify(aggregatedData.summary, null, 2)}

### 2. OBJECTION TAXONOMY:
${JSON.stringify(aggregatedData.objectionTaxonomy, null, 2)}

### 3. ACTIVE CREATIVE VARIANTS & CONVERSATION STARTERS:
${JSON.stringify(
  aggregatedData.variants.map((v) => ({
    adName: v.adName,
    adId: v.adId,
    impressions: v.impressions,
    spend: v.spend,
    ctr: v.ctr,
    linkClicks: v.linkClicks,
    configuredStarter: v.configuredStarter,
    configuredIcebreakers: v.configuredIcebreakers,
    startersBreakdown: v.startersBreakdown,
    chats: v.firestoreChats,
    scans: v.scansTriggered,
    ctaSent: v.ctaCardsSent,
    purchases: v.purchases,
    objections: v.objections,
    funnelRates: v.funnelRates,
  })),
  null,
  2
)}

### 4. WHATSAPP USER JOURNEYS (RAW LOG STEP-BY-STEP TRACES):
${JSON.stringify(
  aggregatedData.variants.flatMap((v) =>
    (v.journeys || []).map((j) => ({
      adName: v.adName,
      userWaId: j.waId,
      dropOffStage: j.dropOffStage,
      starterUsed: j.starter,
      starterType: j.starterType,
      totalSteps: j.totalSteps,
      trajectorySteps: j.steps,
    }))
  ),
  null,
  2
)}

---
### YOUR TASK:
Provide a rigorous, executive-level diagnostic report covering:
1. **Executive Summary & Unit Economics**: ROI, Cost per Qualified WhatsApp Lead, Scan rate, and CTA pitch rate.
2. **Ad Creative & Copy Audit**: Pinpoint which visual angles or headlines generated high vs low intent.
3. **Conversational Bottleneck & Objection Analysis**: Why did unconverted users drop off? What were their exact friction points?
4. **Concrete Agent Prompt Patches (for \`functions/scripts/sync_mba.js\`)**: Give EXACT prompt lines to add/update in \`CORE_SKILL\` to fix the day's dominant drop-offs.
5. **New Creative Iteration Ideas**: 2 specific new prompt angles to generate in Midjourney/Flux for tomorrow.

Respond in clean, professional GitHub Markdown.`;

  if (geminiKey) {
    try {
      return await callGemini(geminiKey, prompt);
    } catch (err) {
      console.warn('Gemini evaluation failed, falling back:', err.message);
    }
  }

  if (openaiKey) {
    try {
      return await callOpenAI(openaiKey, prompt);
    } catch (err) {
      console.warn('OpenAI evaluation failed, falling back:', err.message);
    }
  }

  return runHeuristicEvaluation(aggregatedData);
}

module.exports = {
  evaluateLoopPerformance,
  runHeuristicEvaluation,
};
