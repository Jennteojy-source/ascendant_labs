const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { config, findPartner, recommendFromScan } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, getQueryValue, cors, graphPostJson, WARM_HTTP } = require("../lib/http");
const { resolveIpInfo, formatDisplayIp } = require("../lib/ip");

function sendWhatsAppText(to, text) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to || !text) {
    return Promise.resolve();
  }
  const digits = String(to).replace(/\D/g, "");
  return graphPostJson(
    "graph.facebook.com",
    `/v21.0/${config.whatsappPhoneNumberId}/messages`,
    config.wabaToken,
    {
      messaging_product: "whatsapp",
      to: digits,
      type: "text",
      text: { preview_url: false, body: text },
    }
  );
}

const SCAN_CTA_URL = "https://ascendantlabs.co/scan_v2";
const SCAN_CTA_IMAGE = "https://ascendantlabs.co/scan_v2/scan_card.jpg";
const OFFER_CTA_IMAGES = {
  nordvpn: "https://ascendantlabs.co/wa/nordvpn_card.jpg",
  proton_vpn: "https://ascendantlabs.co/wa/proton_card.jpg",
};

function offerCtaImage(slug) {
  const key = String(slug || "").toLowerCase();
  if (key.includes("proton")) return OFFER_CTA_IMAGES.proton_vpn;
  return OFFER_CTA_IMAGES.nordvpn;
}

function extractInboundText(message) {
  if (!message) return "";
  if (message.text && message.text.body) return String(message.text.body);
  if (message.button && message.button.text) return String(message.button.text);
  if (message.interactive && message.interactive.button_reply) {
    return String(message.interactive.button_reply.title || message.interactive.button_reply.id || "");
  }
  if (message.interactive && message.interactive.list_reply) {
    return String(message.interactive.list_reply.title || message.interactive.list_reply.id || "");
  }
  if (message.image && message.image.caption) return String(message.image.caption);
  if (message.video && message.video.caption) return String(message.video.caption);
  if (message.document && message.document.caption) return String(message.document.caption);
  return message.type ? `[${message.type}]` : "";
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

/**
 * Click-to-WhatsApp ads attach attribution on the first inbound message only.
 * Cloud API uses message.referral; some payloads also nest context.ad.
 */
function extractAdContext(message) {
  if (!message || typeof message !== "object") return null;
  const referral = message.referral && typeof message.referral === "object" ? message.referral : null;
  const contextAd = message.context && message.context.ad && typeof message.context.ad === "object"
    ? message.context.ad
    : null;
  if (!referral && !contextAd) return null;

  const source = contextAd && contextAd.source && typeof contextAd.source === "object" ? contextAd.source : {};
  const welcome = referral && referral.welcome_message && typeof referral.welcome_message === "object"
    ? referral.welcome_message
    : null;

  const ctwaClid = String((referral && referral.ctwa_clid) || (contextAd && (contextAd.ctwa || contextAd.ctwa_clid)) || "").trim();
  const adId = String((referral && referral.source_id) || source.id || "").trim();
  const sourceType = String((referral && referral.source_type) || source.type || "").trim();
  const sourceUrl = String((referral && referral.source_url) || source.url || "").trim();
  const headline = String((referral && referral.headline) || "").trim();
  const body = String((referral && referral.body) || "").trim();
  const welcomeMessage = String((welcome && welcome.text) || "").trim();

  if (!ctwaClid && !adId && !sourceType && !sourceUrl) return null;

  return {
    fromAd: sourceType ? sourceType === "ad" : true,
    ctwaClid,
    adId,
    sourceType: sourceType || "ad",
    sourceUrl,
    headline,
    body,
    welcomeMessage,
    mediaType: String((referral && referral.media_type) || "").trim(),
  };
}

function adContextConvoFields(adContext) {
  if (!adContext) return null;
  const fields = {
    fromAd: !!adContext.fromAd,
    sourceType: adContext.sourceType || "ad",
  };
  if (adContext.ctwaClid) fields.ctwaClid = adContext.ctwaClid;
  if (adContext.adId) fields.adId = adContext.adId;
  if (adContext.sourceUrl) fields.sourceUrl = adContext.sourceUrl;
  if (adContext.headline) fields.adHeadline = adContext.headline;
  if (adContext.body) fields.adBody = adContext.body;
  if (adContext.welcomeMessage) fields.adWelcomeMessage = adContext.welcomeMessage;
  if (adContext.mediaType) fields.adMediaType = adContext.mediaType;
  return fields;
}

async function storeWaMessage(waId, fields) {
  if (!waId) return;
  const ts = Date.now();
  const messageId = String(fields.id || `msg_${ts}_${crypto.randomBytes(3).toString("hex")}`).slice(0, 128);
  const text = String(fields.text || "").slice(0, 8000);
  const adContext = fields.adContext || extractAdContext(fields.raw);
  const convoRef = db.collection("wa_conversations").doc(waId);
  const msgRef = convoRef.collection("messages").doc(messageId);
  const [existing, convoSnap] = await Promise.all([msgRef.get(), convoRef.get()]);
  const record = {
    id: messageId,
    waId,
    direction: fields.direction || "inbound",
    type: fields.type || "text",
    text,
    source: fields.source || "messages",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ts: fields.ts || ts,
    raw: cloneJson(fields.raw) || null,
  };
  if (adContext) {
    record.adContext = cloneJson(adContext);
    if (adContext.ctwaClid) record.ctwaClid = adContext.ctwaClid;
    if (adContext.adId) record.adId = adContext.adId;
  }

  await msgRef.set(record, { merge: true });

  const convoUpdate = {
    waId,
    lastMessage: text.slice(0, 500),
    lastDirection: record.direction,
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!existing.exists) {
    convoUpdate.messageCount = admin.firestore.FieldValue.increment(1);
  }
  if (fields.sid) convoUpdate.lastSid = fields.sid;
  if (fields.contactName) convoUpdate.contactName = fields.contactName;

  const existingConvo = convoSnap.exists ? convoSnap.data() || {} : {};
  const alreadyAttributed = !!(existingConvo.ctwaClid || existingConvo.adId);
  const promo = adContextConvoFields(adContext);
  if (promo && !alreadyAttributed) {
    Object.assign(convoUpdate, promo);
    convoUpdate.adAttributedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await convoRef.set(convoUpdate, { merge: true });
}

function sendCtaUrlCard(to, fields) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to) {
    return Promise.resolve({ skipped: true });
  }
  const digits = String(to).replace(/\D/g, "");
  const interactive = {
    type: "cta_url",
    body: { text: String(fields.body || "").slice(0, 1024) },
    action: {
      name: "cta_url",
      parameters: {
        display_text: String(fields.displayText || "Open").slice(0, 20),
        url: fields.url,
      },
    },
  };
  if (fields.image) {
    interactive.header = { type: "image", image: { link: fields.image } };
  }
  if (fields.footer) {
    interactive.footer = { text: String(fields.footer).slice(0, 60) };
  }
  return graphPostJson(
    "graph.facebook.com",
    `/v21.0/${config.whatsappPhoneNumberId}/messages`,
    config.wabaToken,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: digits,
      type: "interactive",
      interactive,
    }
  );
}

function sendScanCtaCard(to) {
  const digits = String(to || "").replace(/\D/g, "");
  return sendCtaUrlCard(digits, {
    image: SCAN_CTA_IMAGE,
    body: "Run a quick connection check so I can diagnose what your network exposes.",
    footer: "Fast, automatic scan",
    displayText: "Scan my connection",
    url: `${SCAN_CTA_URL}?wa=${digits}`,
  });
}

async function sendOfferCtaCard(to, recommendation, url, sid) {
  const digits = String(to || "").replace(/\D/g, "");
  if (!digits || !url) return { skipped: true };
  const trackedUrl = appendQuery(url, "wa", digits);
  const convoRef = db.collection("wa_conversations").doc(digits);
  try {
    const snap = await convoRef.get();
    const data = snap.exists ? snap.data() || {} : {};
    if (sid && data.offerCtaSid && data.offerCtaSid === sid) {
      return { skipped: true, reason: "already_sent" };
    }
  } catch (_) {}
  const slug = recommendation && recommendation.primary;
  const label = `Open ${offerLabel(slug)}`.slice(0, 20);
  const result = await sendCtaUrlCard(digits, {
    image: offerCtaImage(slug),
    body: "Tap below to encrypt this connection with the recommended VPN. 30-day money-back guarantee.",
    footer: "30-day money-back guarantee",
    displayText: label,
    url: trackedUrl,
  });
  try {
    await convoRef.set({
      offerCtaSid: sid || "",
      offerCtaSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await storeWaMessage(digits, {
      id: `offer_cta_${Date.now()}`,
      direction: "outbound",
      type: "cta_url",
      text: label,
      source: "cloud_api",
      raw: { url: trackedUrl, image: offerCtaImage(slug), status: result && result.status },
    });
  } catch (err) {
    console.error("offer CTA Firestore write error:", err);
  }
  return result;
}

function releaseThreadControl(to) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to) {
    return Promise.resolve({ skipped: true });
  }
  const digits = String(to).replace(/\D/g, "");
  return graphPostJson(
    "graph.facebook.com",
    `/v21.0/${config.whatsappPhoneNumberId}/thread_control`,
    config.wabaToken,
    {
      messaging_product: "whatsapp",
      action: "release",
      to: digits,
    }
  );
}

async function maybeSendScanCta(waId, inboundText) {
  if (!waId) return;
  const alreadyScanned = /\bSCAN_COMPLETE\b/i.test(inboundText || "");
  if (alreadyScanned) return;

  const convoRef = db.collection("wa_conversations").doc(waId);
  const snap = await convoRef.get();
  const data = snap.exists ? snap.data() || {} : {};
  if (data.scanCtaSentAt || data.lastSid) return;

  const result = await sendScanCtaCard(waId);
  const sent = result && result.status >= 200 && result.status < 300;
  if (sent) {
    await releaseThreadControl(waId);
  }
  const scanCtaUpdate = {
    scanCtaStatus: result && result.status ? result.status : 0,
  };
  if (sent) {
    scanCtaUpdate.scanCtaSentAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await convoRef.set(scanCtaUpdate, { merge: true });
  if (sent) {
    await storeWaMessage(waId, {
      id: `cta_${Date.now()}`,
      direction: "outbound",
      type: "cta_url",
      text: "Scan my connection",
      source: "cloud_api",
      raw: { url: `${SCAN_CTA_URL}?wa=${waId}`, status: result && result.status },
    });
  }
}

function appendQuery(url, key, value) {
  if (!url || !value) return url || "";
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.get(key)) parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch (_) {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}${key}=${encodeURIComponent(value)}`;
  }
}

function offerLabel(slug) {
  const found = findPartner(slug);
  return found && found[1] && found[1].label ? found[1].label : "VPN";
}

function buildScanCompletedEvent(scan, recommendation, description) {
  const sid = scan.sid || "";
  const waId = String(scan.waId || "").replace(/\D/g, "");
  const primaryLink = appendQuery(appendQuery(
    recommendation.shortLinks?.primary || "https://ascendantlabs.co/r/vpn",
    "sid",
    sid
  ), "wa", waId);
  const alternativeLink = appendQuery(appendQuery(
    recommendation.shortLinks?.alternative || "https://ascendantlabs.co/r/proton-vpn",
    "sid",
    sid
  ), "wa", waId);
  const payloadObj = {
    sid,
    lang: scan.lang || "",
    ip: scan.ip,
    city: scan.city,
    country: scan.country,
    isp: scan.isp,
    device: scan.device,
    primary: recommendation.primary,
    alternative: recommendation.alternative,
    angle: recommendation.angle,
    reply_now: true,
    response_goal: "Diagnose this connection now. Use the exact ISP, location, IP, and device details, explain the practical exposure, then ask one short question to identify the user's main concern. Do not wait for another user message.",
    primary_link: primaryLink,
    alternative_link: alternativeLink,
    scan_cta_url: waId ? `https://ascendantlabs.co/scan_v2?wa=${waId}` : "https://ascendantlabs.co/scan_v2",
    scan_cta_image: SCAN_CTA_IMAGE,
    offer_cta_url: primaryLink,
    offer_cta_label: `Open ${offerLabel(recommendation.primary)}`,
    offer_cta_image: offerCtaImage(recommendation.primary),
    alternative_cta_image: offerCtaImage(recommendation.alternative),
    nordvpn_cta_image: OFFER_CTA_IMAGES.nordvpn,
    proton_cta_image: OFFER_CTA_IMAGES.proton_vpn,
  };

  return {
    type: "connection_scan_completed",
    description,
    payload: JSON.stringify(payloadObj),
  };
}

async function sendAgentEvent(to, event) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to) {
    return { skipped: true };
  }
  const digits = String(to).replace(/\D/g, "");
  const formattedPayload = typeof event.payload === "string"
    ? event.payload
    : JSON.stringify(event.payload || {});

  const agentEventPayload = {
    type: event.type,
    description: event.description,
    payload: formattedPayload,
  };

  const eventId = `evt_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  let parsedPayload = null;
  try {
    parsedPayload = JSON.parse(formattedPayload);
  } catch (_) {
    parsedPayload = formattedPayload;
  }

  const eventRef = db.collection("wa_conversations").doc(digits).collection("agent_events").doc(eventId);
  const convoRef = db.collection("wa_conversations").doc(digits);
  const deliveryPromise = graphPostJson(
    "api.facebook.com",
    `/${config.whatsappPhoneNumberId}/agent_event`,
    config.wabaToken,
    {
      to: `+${digits}`,
      event: agentEventPayload,
    },
    { "X-API-Version": "2.0.0" }
  );

  const persistencePromise = Promise.all([
    eventRef.set({
      id: eventId,
      waId: digits,
      type: event && event.type ? event.type : "unknown",
      description: event && event.description ? event.description : "",
      payload: parsedPayload,
      rawPayload: formattedPayload,
      event: cloneJson(agentEventPayload),
      graphStatus: 0,
      deliveryState: "sending",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ts: Date.now(),
    }),
    convoRef.set({
      waId: digits,
      lastAgentEventType: event && event.type ? event.type : "",
      lastAgentEventAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]).catch((err) => {
    console.error("agent_event Firestore write error:", err);
  });

  const [result] = await Promise.all([deliveryPromise, persistencePromise]);

  try {
    await eventRef.set({
      graphStatus: result && result.status ? result.status : 0,
      graphBody: cloneJson(typeof result.body === "string" ? (() => { try { return JSON.parse(result.body); } catch (_) { return result.body; } })() : result.body),
      deliveryState: result && result.status >= 200 && result.status < 300 ? "accepted" : "failed",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error("agent_event delivery update error:", err);
  }

  return result;
}

function buildWhatsAppReturnUrl() {
  const phone = config.whatsappDisplayNumber;
  return {
    waMe: `https://wa.me/${phone}`,
    deepLink: `whatsapp://send?phone=${phone}`,
  };
}

function extractScanSid(text) {
  const match = String(text || "").match(/\bsid:([a-zA-Z0-9_-]+)/);
  return match ? match[1] : "";
}

const completeConnectionScan = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const body = req.body || {};
  const sid = String(body.sid || crypto.randomUUID()).slice(0, 80);
  const waId = String(body.waId || body.wa || "").replace(/\D/g, "");
  const ip = getClientIp(req);
  const info = await resolveIpInfo(ip);
  const displayIp = formatDisplayIp(ip);
  const device = String(body.device || "").slice(0, 80);

  const scan = {
    sid,
    lang: String(body.lang || "").toLowerCase().slice(0, 5),
    ip: displayIp,
    rawIp: ip || "",
    city: info?.city || body.city || "",
    district: info?.district || "",
    region: info?.region || body.region || "",
    country: info?.country || body.country || "",
    isp: info?.isp || body.isp || "",
    device,
    waId: waId || "",
    clickId: body.clickId || "",
    userAgent: req.get("user-agent") || "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const recommendation = recommendFromScan(scan);
  scan.recommendation = recommendation;

  const persistScan = Promise.all([
    db.collection("connection_scans").doc(sid).set(scan, { merge: true }),
    waId
      ? db.collection("wa_conversations").doc(waId).set({
        waId,
        lastSid: sid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      : Promise.resolve(),
  ]).catch((err) => {
    console.error("Scan Firestore write error:", err);
  });

  const agentEvent = waId
    ? sendAgentEvent(
      waId,
      buildScanCompletedEvent(
        scan,
        recommendation,
        `Connection scan completed. Respond immediately without waiting for another message. Diagnose the connection using ISP ${scan.isp || "unknown"}, location ${scan.city || scan.country || "unknown"}, exposed IP ${scan.ip || "unknown"}, and device ${scan.device || "unknown"}. Ask one short question to identify the user's main concern before prescribing the best VPN.`
      )
    )
    : Promise.resolve({ skipped: true });

  const [agentResult] = await Promise.all([agentEvent, persistScan]);

  const returnUrls = buildWhatsAppReturnUrl();
  res.status(200).json({
    success: true,
    sid,
    agentEventDelivered: !!(agentResult && agentResult.status >= 200 && agentResult.status < 300),
    telemetry: {
      ip: scan.ip,
      city: scan.city,
      region: scan.region,
      country: scan.country,
      isp: scan.isp,
      device: scan.device,
    },
    recommendation,
    returnUrls,
  });
});

const getConnectionScan = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const sid = getQueryValue(req, "sid") || String(req.path || "").split("/").filter(Boolean).pop();
  if (!sid || sid === "scan") {
    res.status(400).json({ error: "Missing sid" });
    return;
  }

  try {
    const doc = await db.collection("connection_scans").doc(sid).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    const data = doc.data() || {};
    res.status(200).json({
      sid,
      telemetry: {
        ip: data.ip || null,
        city: data.city || null,
        region: data.region || null,
        country: data.country || null,
        isp: data.isp || null,
        device: data.device || null,
      },
      recommendation: data.recommendation || recommendFromScan(data),
    });
  } catch (err) {
    console.error("getConnectionScan error:", err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

async function handleScanReturn(from, sid) {
  if (!from || !sid) return;
  const scanDoc = await db.collection("connection_scans").doc(sid).get();
  if (!scanDoc.exists) return;
  const scan = scanDoc.data() || {};
  await db.collection("connection_scans").doc(sid).set({ waId: from }, { merge: true });
  const recommendation = scan.recommendation || recommendFromScan(scan);
  await sendAgentEvent(
    from,
    buildScanCompletedEvent(
      { ...scan, sid, waId: from },
      recommendation,
      `User returned from connection scan ${sid}. ISP ${scan.isp || "unknown"} in ${scan.country || "unknown"}.`
    )
  );
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function unwrapStandbyItems(items) {
  const messages = [];
  const echoes = [];
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.messages)) messages.push(...item.messages);
    if (Array.isArray(item.message_echoes)) echoes.push(...item.message_echoes);
    if (item.message && (item.sender || item.recipient)) {
      const from = digitsOnly(item.sender && item.sender.id);
      messages.push({
        ...item.message,
        from: item.message.from || from,
        id: item.message.mid || item.message.id,
        referral: item.message.referral || item.referral,
        context: item.message.context || item.context,
      });
      continue;
    }
    if (item.to && (item.from || item.type || item.text)) {
      echoes.push(item);
      continue;
    }
    if (item.from || item.type || item.text || item.id) {
      messages.push(item);
    }
  }
  return { messages, echoes };
}

function collectInboundMessages(value) {
  const fromValue = [...(value.messages || [])];
  const fromStandby = unwrapStandbyItems(value.standby);
  return [...fromValue, ...fromStandby.messages];
}

function collectEchoMessages(value) {
  const fromValue = [
    ...(value.message_echoes || []),
    ...(value.smb_message_echoes || []),
  ];
  const fromStandby = unwrapStandbyItems(value.standby);
  return [...fromValue, ...fromStandby.echoes];
}

async function persistInboundMessage(message, extras = {}) {
  const from = digitsOnly(message.from || message.wa_id);
  const businessNumber = extras.businessNumber || "";
  if (!from || (businessNumber && from === businessNumber)) return;
  const text = extractInboundText(message);
  const sid = extractScanSid(text);
  const ts = Number(message.timestamp) ? Number(message.timestamp) * 1000 : Date.now();
  await storeWaMessage(from, {
    id: message.id,
    direction: "inbound",
    type: message.type || "text",
    text,
    sid,
    contactName: extras.contactName || "",
    source: extras.source || "messages",
    ts,
    raw: message,
    adContext: extractAdContext(message),
  });
  await handleScanReturn(from, sid);
  if (!sid) {
    await maybeSendScanCta(from, text);
  }
}

async function persistEchoMessage(echo, extras = {}) {
  const businessNumber = extras.businessNumber || "";
  const to = digitsOnly(echo.to || echo.recipient_id);
  const from = digitsOnly(echo.from);
  const waId = to && to !== businessNumber ? to : (from && from !== businessNumber ? from : to);
  if (!waId || waId === businessNumber) return;
  const ts = Number(echo.timestamp) ? Number(echo.timestamp) * 1000 : Date.now();
  await storeWaMessage(waId, {
    id: echo.id,
    direction: "outbound",
    type: echo.type || "text",
    text: extractInboundText(echo),
    source: extras.source || "echo",
    ts,
    raw: echo,
  });
}

async function persistHistory(value, extras = {}) {
  const chunks = value.history || [];
  const businessNumber = extras.businessNumber || "";
  for (const chunk of chunks) {
    for (const thread of (chunk.threads || [])) {
      const waId = digitsOnly(thread.id);
      if (!waId) continue;
      for (const message of (thread.messages || [])) {
        const from = digitsOnly(message.from);
        const direction = from && from === businessNumber ? "outbound" : "inbound";
        const target = direction === "inbound" ? from || waId : waId;
        const ts = Number(message.timestamp) ? Number(message.timestamp) * 1000 : Date.now();
        await storeWaMessage(target, {
          id: message.id,
          direction,
          type: message.type || "text",
          text: extractInboundText(message),
          source: "history",
          ts,
          raw: message,
          adContext: extractAdContext(message),
        });
      }
    }
  }
}

async function processWhatsAppChange(change) {
  const field = String(change.field || "messages");
  const value = change.value || {};
  const contacts = value.contacts || [];
  const contactName = contacts[0] && contacts[0].profile ? contacts[0].profile.name : "";
  const businessNumber = digitsOnly(value.metadata && value.metadata.display_phone_number);
  const source = field === "standby" ? "standby" : field;

  for (const message of collectInboundMessages(value)) {
    await persistInboundMessage(message, { contactName, source, businessNumber });
  }
  for (const echo of collectEchoMessages(value)) {
    await persistEchoMessage(echo, { businessNumber, source: source === "standby" ? "standby" : "echo" });
  }
  if (field === "history" || value.history) {
    await persistHistory(value, { businessNumber });
  }
}

const whatsappWebhook = onRequest(WARM_HTTP, async (req, res) => {
  if (req.method === "GET") {
    const mode = getQueryValue(req, "hub.mode");
    const token = getQueryValue(req, "hub.verify_token");
    const challenge = getQueryValue(req, "hub.challenge");
    if (mode === "subscribe" && token && token === config.webhookVerifyToken) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  const body = req.body || {};
  try {
    const entries = body.entry || [];
    for (const entry of entries) {
      if (Array.isArray(entry.standby) && entry.standby.length) {
        await processWhatsAppChange({
          field: "standby",
          value: { standby: entry.standby, metadata: entry.metadata || {} },
        });
      }
      for (const change of (entry.changes || [])) {
        await processWhatsAppChange(change);
      }
    }
  } catch (err) {
    console.error("whatsappWebhook error:", err);
  }

  res.status(200).send("EVENT_RECEIVED");
});


module.exports = {
  sendWhatsAppText,
  offerCtaImage,
  extractAdContext,
  storeWaMessage,
  sendScanCtaCard,
  sendOfferCtaCard,
  buildScanCompletedEvent,
  sendAgentEvent,
  completeConnectionScan,
  getConnectionScan,
  whatsappWebhook,
};
