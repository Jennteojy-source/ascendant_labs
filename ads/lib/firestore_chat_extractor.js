/**
 * Firestore Chat & Conversion Extractor for CTWA Funnel
 * Ascendant Labs / ScaleDM
 */

const path = require('path');
const fs = require('fs');
let admin;
try {
  admin = require('../../functions/node_modules/firebase-admin');
} catch (_) {
  try {
    admin = require('firebase-admin');
  } catch (err) {
    console.error('Failed to load firebase-admin. Please ensure functions/node_modules is installed.');
    throw err;
  }
}

let isInitialized = false;

function initFirestore() {
  if (isInitialized || admin.apps.length > 0) {
    isInitialized = true;
    return admin.firestore();
  }

  const keyPath = path.resolve(__dirname, '../../firebase-key.json');
  if (fs.existsSync(keyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || 'ascendant-labs-45812',
    });
  } else {
    admin.initializeApp();
  }

  isInitialized = true;
  return admin.firestore();
}

/**
 * Normalizes Firestore timestamp / integer ms / ISO string into Date
 */
function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (val._seconds) return new Date(val._seconds * 1000);
  if (typeof val === 'number') return new Date(val);
  if (typeof val === 'string') return new Date(val);
  return null;
}

/**
 * Fetch all conversations in a time range and hydrate with messages and scan diagnostic data
 */
async function fetchWhatsAppConversations({
  sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000),
  untilDate = new Date(),
  limit = 200,
} = {}) {
  const db = initFirestore();
  const sinceTimestamp = admin.firestore.Timestamp.fromDate(sinceDate);

  let convsQuery = db
    .collection('wa_conversations')
    .orderBy('updatedAt', 'desc')
    .limit(limit);

  const convsSnap = await convsQuery.get();
  if (convsSnap.empty) {
    return [];
  }

  const hydratedConversations = [];

  for (const doc of convsSnap.docs) {
    const data = doc.data() || {};
    const updatedAt = toDate(data.updatedAt);
    const createdAt = toDate(data.createdAt) || toDate(data.adAttributedAt) || updatedAt;

    // Time window filter
    if (updatedAt && updatedAt < sinceDate) {
      continue;
    }
    if (untilDate && updatedAt && updatedAt > untilDate) {
      continue;
    }

    const waId = doc.id;

    // Fetch messages subcollection
    const messagesSnap = await doc.ref
      .collection('messages')
      .orderBy('ts', 'asc')
      .get()
      .catch(() => ({ docs: [] }));

    const messages = [];
    let initialUserMsg = '';
    let scanTriggered = false;
    let scanData = null;
    let offerCtaSent = !!data.offerCtaSid || !!data.offerCtaSentAt;
    let offerProduct = '';
    let extractedAdId = data.adId || '';
    let extractedCtwaClid = data.ctwaClid || '';
    let extractedHeadline = data.adHeadline || '';

    messagesSnap.docs.forEach((mDoc) => {
      const m = mDoc.data() || {};
      const direction = m.direction || (m.source === 'messages' ? 'inbound' : 'outbound');
      const sender = direction === 'inbound' ? 'user' : 'agent';
      const text = m.text || '';
      const type = m.type || 'text';

      if (m.adContext) {
        if (!extractedAdId && m.adContext.adId) extractedAdId = m.adContext.adId;
        if (!extractedCtwaClid && m.adContext.ctwaClid) extractedCtwaClid = m.adContext.ctwaClid;
        if (!extractedHeadline && m.adContext.headline) extractedHeadline = m.adContext.headline;
      }
      if (m.raw && m.raw.referral) {
        if (!extractedAdId && m.raw.referral.source_id) extractedAdId = m.raw.referral.source_id;
        if (!extractedCtwaClid && m.raw.referral.ctwa_clid) extractedCtwaClid = m.raw.referral.ctwa_clid;
        if (!extractedHeadline && m.raw.referral.headline) extractedHeadline = m.raw.referral.headline;
      }

      if (sender === 'user' && !initialUserMsg && text) {
        initialUserMsg = text;
      }

      if (type === 'cta_url' || text.toLowerCase().includes('nordvpn') || text.toLowerCase().includes('proton')) {
        if (text.toLowerCase().includes('proton')) {
          offerProduct = 'Proton VPN';
        } else if (text.toLowerCase().includes('nord')) {
          offerProduct = 'NordVPN';
        }
      }

      messages.push({
        id: mDoc.id,
        sender,
        direction,
        type,
        text,
        ts: m.ts || (m.timestamp ? toDate(m.timestamp)?.getTime() : null),
      });
    });

    // Check if a diagnostic scan exists for this user
    if (data.lastSid) {
      try {
        const scanDoc = await db.collection('connection_scans').doc(data.lastSid).get();
        if (scanDoc.exists) {
          scanTriggered = true;
          scanData = scanDoc.data() || {};
        }
      } catch (_) {}
    }

    // Determine dropoff state
    const lastMsg = messages[messages.length - 1] || {};
    const turnCount = messages.length;
    const isFromAd = !!(data.fromAd || extractedAdId || extractedCtwaClid);

    // Build raw log journey trajectory
    const journey = buildJourneyFromRawLogs(messages, data, scanData);

    hydratedConversations.push({
      waId,
      adId: extractedAdId,
      ctwaClid: extractedCtwaClid,
      adHeadline: extractedHeadline,
      adBody: data.adBody || '',
      adWelcomeMessage: data.adWelcomeMessage || '',
      isFromAd,
      createdAt,
      updatedAt,
      messageCount: turnCount,
      initialUserMsg: journey.conversationStarter || initialUserMsg,
      conversationStarter: journey.conversationStarter,
      starterType: journey.starterType,
      journey,
      scanTriggered: journey.scanCompleted || scanTriggered,
      scanData: scanData
        ? {
            isp: scanData.isp || scanData.org || '',
            city: scanData.city || '',
            country: scanData.country || '',
            ip: scanData.ip ? '***' + String(scanData.ip).slice(-4) : '',
            score: scanData.score || null,
          }
        : null,
      offerCtaSent: journey.reachedOfferCard || offerCtaSent,
      offerProduct,
      lastSender: lastMsg.sender || 'unknown',
      lastMessageText: lastMsg.text || '',
      messages,
    });
  }

  return hydratedConversations;
}

function buildJourneyFromRawLogs(messages, convoData, scanData) {
  const steps = [];
  let reachedScanCard = false;
  const scanCompleted = !!(scanData && (scanData.isp || scanData.ip));
  let reachedOfferCard = false;
  let conversationStarter = '';
  let starterType = 'UNKNOWN';

  messages.forEach((m, idx) => {
    const isUser = m.sender === 'user';
    const text = m.text || '';
    const type = m.type || 'text';

    if (idx === 0 || (!conversationStarter && isUser)) {
      conversationStarter = text;
      starterType = m.adContext || (m.raw && m.raw.referral) ? 'PREFILLED_AD_ICEBREAKER' : 'CUSTOM_USER_MESSAGE';
      steps.push({
        stepIndex: steps.length + 1,
        type: 'CONVERSATION_STARTER',
        sender: 'user',
        text,
        starterType,
        adReferral: m.adContext || (m.raw && m.raw.referral) || null,
        time: m.ts ? new Date(m.ts).toISOString() : null,
      });
      return;
    }

    if (type === 'cta_url' && text.toLowerCase().includes('scan')) {
      reachedScanCard = true;
      steps.push({
        stepIndex: steps.length + 1,
        type: 'SCAN_CTA_DISPATCHED',
        sender: 'agent',
        title: text,
        url: (m.raw && m.raw.url) || 'https://ascendantlabs.co/scan_v2',
        time: m.ts ? new Date(m.ts).toISOString() : null,
      });
      return;
    }

    if (type === 'cta_url' && (text.toLowerCase().includes('nord') || text.toLowerCase().includes('proton'))) {
      reachedOfferCard = true;
      steps.push({
        stepIndex: steps.length + 1,
        type: 'OFFER_CTA_DISPATCHED',
        sender: 'agent',
        title: text,
        product: text.toLowerCase().includes('proton') ? 'Proton VPN' : 'NordVPN',
        url: (m.raw && m.raw.url) || '',
        time: m.ts ? new Date(m.ts).toISOString() : null,
      });
      return;
    }

    steps.push({
      stepIndex: steps.length + 1,
      type: isUser ? 'USER_MESSAGE' : 'AGENT_RESPONSE',
      sender: m.sender,
      text,
      time: m.ts ? new Date(m.ts).toISOString() : null,
    });
  });

  if (scanCompleted) {
    steps.push({
      stepIndex: steps.length + 1,
      type: 'SCAN_DIAGNOSIS_COMPLETED',
      isp: scanData.isp || scanData.org || 'Exposed ISP',
      city: scanData.city || '',
      country: scanData.country || '',
      ip: scanData.ip ? '***' + String(scanData.ip).slice(-4) : '',
      score: scanData.score || null,
    });
  }

  const lastMsg = messages[messages.length - 1] || {};
  let dropOffStage = 'IN_PROGRESS';
  if (reachedOfferCard) {
    dropOffStage = 'POST_OFFER_EVALUATION';
  } else if (reachedScanCard && !scanCompleted && messages.length <= 3) {
    dropOffStage = 'ABANDONED_AT_SCAN_GATE';
  } else if (messages.length <= 2) {
    dropOffStage = 'ABANDONED_AT_STARTER';
  } else if (lastMsg.sender === 'agent') {
    dropOffStage = 'GHOSTED_DURING_SPIN_DISCOVERY';
  }

  return {
    conversationStarter,
    starterType,
    totalSteps: steps.length,
    reachedScanCard,
    scanCompleted,
    reachedOfferCard,
    dropOffStage,
    steps,
  };
}

module.exports = {
  fetchWhatsAppConversations,
  initFirestore,
};
