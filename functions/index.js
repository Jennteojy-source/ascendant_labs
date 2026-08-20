const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const {
  config,
  buildAffiliateUrl,
  buildPartnerUrl,
  findPartner,
  recommendFromScan,
} = require("./config");

admin.initializeApp();
const db = admin.firestore();

function getClientIp(req) {
  let forwarded = "";
  if (typeof req.get === "function") {
    forwarded = req.get("x-forwarded-for") || "";
  } else if (req.headers && req.headers["x-forwarded-for"]) {
    forwarded = req.headers["x-forwarded-for"];
  }

  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    // If the chain contains a true IPv6 address, prioritize it for Meta CAPI
    const ipv6 = parts.find((ip) => ip.includes(":") && !ip.startsWith("::ffff:"));
    if (ipv6) return ipv6;
    return parts[0].replace(/^::ffff:/, "");
  }
  const direct = req.ip || (req.connection && req.connection.remoteAddress) || "";
  return direct.replace(/^::ffff:/, "");
}

function getQueryValue(req, key) {
  const value = req.query[key];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

/**
 * Generic Meta CAPI event sender.
 * @param {string} eventName - Meta standard event (e.g. "ViewContent", "Lead", "CompleteRegistration", "InitiateCheckout", "Purchase")
 * @param {string} eventId - Unique dedup ID for this event
 * @param {object} userData - { fbc, client_ip_address, client_user_agent }
 * @param {object} [customData] - Optional { currency, value, content_name, ... }
 * @param {string} [eventSourceUrl] - The URL where the event occurred
 */
function sendMetaCapiEvent(eventName, eventId, userData, customData = null, eventSourceUrl = "https://ascendantlabs.co/nordvpn/quiz") {
  if (!config.datasetId || !config.capiAccessToken) {
    console.log("Meta CAPI skip: missing dataset ID or access token");
    return Promise.resolve();
  }

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: {
      ...(userData.fbc ? { fbc: userData.fbc } : {}),
      ...(userData.fbp ? { fbp: userData.fbp } : {}),
      ...(userData.external_id ? { external_id: crypto.createHash("sha256").update(userData.external_id).digest("hex") } : {}),
      client_ip_address: userData.client_ip_address || "",
      client_user_agent: userData.client_user_agent || "",
    },
  };

  if (customData) {
    event.custom_data = customData;
  }

  const payload = { data: [event] };
  const postData = JSON.stringify(payload);
  const options = {
    hostname: "graph.facebook.com",
    path: `/v25.0/${config.datasetId}/events`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "Authorization": `Bearer ${config.capiAccessToken}`,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`Meta CAPI [${eventName}] response: status ${res.statusCode}, body: ${body}`);
        resolve();
      });
    });

    req.on("error", (e) => {
      console.error(`Meta CAPI [${eventName}] error: ${e.message}`);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

// ── Telemetry: in-memory cache keyed by IP ──
const telemetryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Resolve IP → { city, country, isp } via server-side ip-api.com call.
 * Single call returns all fields. Strict 2.5s timeout. Results cached in memory.
 */
function resolveIpInfo(ip) {
  // Skip local / loopback
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return Promise.resolve(null);
  }

  // Check cache (with TTL)
  const cached = telemetryCache.get(ip);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return Promise.resolve(cached.data);
  }

  return new Promise((resolve) => {
    const request = http.get(
      `http://ip-api.com/json/${ip}?fields=status,city,district,regionName,country,isp,org,as,query`,
      { timeout: 2500 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status !== "success") {
              resolve(null);
              return;
            }
            const cleanIsp = (parsed.isp || parsed.org || parsed.as || "").replace(/^AS\d+\s+/i, "").trim();

            const result = {
              city: parsed.city || "",
              district: parsed.district || "",
              region: parsed.regionName || "",
              country: parsed.country || "",
              isp: cleanIsp || "",
            };
            telemetryCache.set(ip, { data: result, ts: Date.now() });
            resolve(result);
          } catch (e) {
            console.warn("Telemetry parse error:", e.message);
            resolve(null);
          }
        });
      }
    );

    request.on("error", (e) => {
      console.warn("Telemetry fetch error:", e.message);
      resolve(null);
    });
    request.on("timeout", () => {
      request.destroy();
      console.warn("Telemetry fetch timeout for IP:", ip);
      resolve(null);
    });
  });
}

/**
 * Format raw IP to a clean IPv4 display string.
 * If already IPv4, pass through. If IPv6/other, hash to realistic IPv4.
 */
function formatDisplayIp(rawIp) {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rawIp.trim())) {
    return rawIp.trim();
  }
  let hash = 0;
  const str = String(rawIp);
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const b1 = 100 + Math.abs(hash % 90);
  const b2 = 10 + Math.abs((hash >> 3) % 200);
  const b3 = 10 + Math.abs((hash >> 6) % 220);
  const b4 = 10 + Math.abs((hash >> 9) % 240);
  return `${b1}.${b2}.${b3}.${b4}`;
}

/**
 * /api/telemetry — Native IP & Geo endpoint.
 * Returns { ip, city, district, region, country, isp } with accurate detection.
 * If lookup fails or times out, returns null fields so the frontend can hide them.
 */
exports.getIpTelemetry = onRequest(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const rawIp = getClientIp(req);

  // If we can't get any IP at all, return nulls so frontend hides the section
  if (!rawIp) {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ip: null, city: null, district: null, region: null, country: null, isp: null });
    return;
  }

  const displayIp = formatDisplayIp(rawIp);
  const info = await resolveIpInfo(rawIp);

  res.set("Cache-Control", "no-store");
  res.status(200).json({
    ip: displayIp,
    city: info?.city || null,
    district: info?.district || null,
    region: info?.region || null,
    country: info?.country || null,
    isp: info?.isp || null,
  });
});

/**
 * Handle frontend quiz CAPI events (ViewContent, Lead, CompleteRegistration, InitiateCheckout).
 */
exports.trackQuizEvent = onRequest(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const body = req.body || {};
  const eventName = body.eventName || "ViewContent";
  const clickId = body.clickId || crypto.randomUUID();
  const eventId = body.eventId || `${eventName.toLowerCase()}_${clickId}`;
  const trackingParams = body.trackingParams || {};
  const customData = body.customData || {};
  const eventSourceUrl = body.eventSourceUrl || "https://ascendantlabs.co/nordvpn/quiz";

  const ip = getClientIp(req);
  const userAgent = req.get("user-agent") || "";

  // Pass through _fbc and _fbp cookies from client
  let fbc = body.fbc || null;
  let fbp = body.fbp || null;

  // Fallback 1: Reconstruct fbc if fbclid exists in trackingParams or clickId
  const fbclid = trackingParams.fbclid || (clickId && clickId.length > 20 && !clickId.startsWith("clk_") ? clickId : null);
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
  }

  // Fallback 2: Retrieve previously stored fbc/fbp from Firestore if missing on later funnel steps (Lead / InitiateCheckout)
  if (!fbc || !fbp) {
    try {
      const existingClick = await db.collection("clicks").doc(clickId).get();
      if (existingClick.exists) {
        const clickData = existingClick.data() || {};
        if (!fbc && clickData.fbc) fbc = clickData.fbc;
        if (!fbp && clickData.fbp) fbp = clickData.fbp;
      }
    } catch (_) {}
  }

  // Store click data and quiz results in Firestore for deep analytics
  try {
    const clickData = {
      ip,
      userAgent,
      ...(fbc ? { fbc } : {}),
      ...(fbp ? { fbp } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection("clicks").doc(clickId).set(clickData, { merge: true });

    // Store rich quiz result analytics when quizResult is sent (CompleteRegistration)
    const quizPayload = body.quizResult || customData.quizResult || null;
    if (quizPayload) {
      await db.collection("quiz_results").doc(clickId).set({
        clickId,
        score: quizPayload.score || 0,
        objection: quizPayload.objection || null,
        answers: quizPayload.answers || [],
        ip,
        userAgent,
        ...(fbc ? { fbc } : {}),
        ...(fbp ? { fbp } : {}),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (err) {
    console.error("Firestore write error:", err);
  }

  // Strip non-Meta fields from custom_data before sending to CAPI.
  // Meta only processes flat primitive values in custom_data.
  const { quizResult, ...metaCustomData } = customData;

  try {
    await sendMetaCapiEvent(
      eventName,
      eventId,
      {
        fbc,
        ...(fbp ? { fbp } : {}),
        external_id: clickId,
        client_ip_address: ip,
        client_user_agent: userAgent,
      },
      metaCustomData,
      eventSourceUrl
    );
  } catch (err) {
    console.error(`Error sending CAPI event ${eventName}:`, err);
  }

  res.status(200).json({ success: true, eventName, clickId });
});

/**
 * Handle postback webhooks from NordVPN / affiliate network for Purchase tracking.
 */
exports.nordVpnWebhook = onRequest(async (req, res) => {

  try {
    const clickId =
      getQueryValue(req, "click_id") ||
      getQueryValue(req, "aff_click_id") ||
      getQueryValue(req, "aff_sub") ||
      getQueryValue(req, "adv_sub");
    const transactionId = getQueryValue(req, "transaction_id") || getQueryValue(req, "tx_id");
    const payout = parseFloat(getQueryValue(req, "payout")) || 0;
    const offerId = parseInt(getQueryValue(req, "offer_id"), 10) || Number(config.nordVpn.offerId);
    const saleAmount = parseFloat(getQueryValue(req, "sale_amount")) || parseFloat(getQueryValue(req, "amount")) || 0;
    const currency = getQueryValue(req, "currency") || "USD";
    const goalId = getQueryValue(req, "goal_id");
    const countryCode = getQueryValue(req, "country_code");
    const status = getQueryValue(req, "status");

    if (!transactionId) {
      console.warn("Conversion warning: Missing transaction_id");
      res.status(400).send("Missing transaction_id");
      return;
    }

    const conversionData = {
      clickId,
      partner: config.networkId,
      transactionId,
      payout,
      offerId,
      saleAmount,
      currency: currency || null,
      goalId: goalId || null,
      countryCode: countryCode || null,
      status: status || null,
      rawQuery: req.query,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await db.collection("conversions").doc(transactionId).create(conversionData);
      console.log(`Successfully logged conversion ${transactionId} for click ${clickId}`);
      res.status(200).send("success");
    } catch (err) {
      if (err.code === 6 || err.message.includes("ALREADY_EXISTS")) {
        console.log(`Duplicate conversion ${transactionId} ignored.`);
        res.status(200).send("duplicate");
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error("Error in nordVpnWebhook:", error);
    res.status(500).send("Internal Server Error");
  }
});

async function handleConversionCreated(transactionId, conversionData) {
  if (!conversionData) return;
  const clickId = conversionData.clickId;

  let clickDocData = null;
  if (clickId) {
    try {
      const clickDoc = await db.collection("clicks").doc(clickId).get();
      if (clickDoc.exists) {
        clickDocData = clickDoc.data();
      }
    } catch (err) {
      console.error("Firestore read error looking up click for conversion:", err);
    }
  }

  // Use stored fbc/fbp from Firestore (passed through from client _fbc/_fbp cookies).
  const fbc = clickDocData?.fbc || undefined;
  const fbp = clickDocData?.fbp || undefined;

  try {
    await sendMetaCapiEvent(
      "Purchase",
      transactionId,
      {
        fbc,
        ...(fbp ? { fbp } : {}),
        ...(clickId ? { external_id: clickId } : {}),
        client_ip_address: clickDocData?.ip || "",
        client_user_agent: clickDocData?.userAgent || "",
      },
      {
        currency: conversionData.currency || "USD",
        value: conversionData.saleAmount || conversionData.payout || 0,
      },
      "https://ascendantlabs.co/nordvpn/quiz"
    );
  } catch (error) {
    console.error(`Error sending Purchase CAPI for transaction ${transactionId}:`, error);
  }
}

exports.onConversionCreated = onDocumentCreated("conversions/{transactionId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the conversion event");
    return;
  }
  await handleConversionCreated(event.params.transactionId, snapshot.data());
});

function graphPostJson(hostname, path, token, payload, extraHeaders = {}) {
  const postData = JSON.stringify(payload);
  const options = {
    hostname,
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`Graph POST ${path} status ${res.statusCode}: ${body}`);
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", (e) => {
      console.error(`Graph POST ${path} error: ${e.message}`);
      resolve({ status: 0, body: e.message });
    });
    req.write(postData);
    req.end();
  });
}

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

function sendScanCtaCard(to) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to) {
    return Promise.resolve({ skipped: true });
  }
  const digits = String(to).replace(/\D/g, "");
  return graphPostJson(
    "graph.facebook.com",
    `/v21.0/${config.whatsappPhoneNumberId}/messages`,
    config.wabaToken,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: digits,
      type: "interactive",
      interactive: {
        type: "cta_url",
        header: {
          type: "image",
          image: { link: SCAN_CTA_IMAGE },
        },
        body: {
          text: "I'll check this connection first so we can see what your internet provider already knows. Tap Scan my connection — it auto-scans. When it's done, tap Return to chat.",
        },
        footer: {
          text: "Takes about 6 seconds",
        },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Scan my connection",
            url: `${SCAN_CTA_URL}?wa=${digits}`,
          },
        },
      },
    }
  );
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
  await convoRef.set({
    scanCtaSentAt: admin.firestore.FieldValue.serverTimestamp(),
    scanCtaStatus: result && result.status ? result.status : 0,
  }, { merge: true });
  await storeWaMessage(waId, {
    id: `cta_${Date.now()}`,
    direction: "outbound",
    type: "cta_url",
    text: "Scan my connection",
    source: "cloud_api",
    raw: { url: `${SCAN_CTA_URL}?wa=${waId}`, status: result && result.status },
  });
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
  const primaryLink = appendQuery(
    recommendation.shortLinks?.primary || `https://ascendantlabs.co/r/vpn`,
    "sid",
    sid
  );
  const alternativeLink = appendQuery(
    recommendation.shortLinks?.alternative || `https://ascendantlabs.co/r/proton-vpn`,
    "sid",
    sid
  );
  const payloadObj = {
    sid,
    ip: scan.ip,
    city: scan.city,
    country: scan.country,
    isp: scan.isp,
    device: scan.device,
    primary: recommendation.primary,
    alternative: recommendation.alternative,
    angle: recommendation.angle,
    primary_link: primaryLink,
    alternative_link: alternativeLink,
    scan_cta_url: waId ? `https://ascendantlabs.co/scan_v2?wa=${waId}` : "https://ascendantlabs.co/scan_v2",
    offer_cta_url: primaryLink,
    offer_cta_label: `Open ${offerLabel(recommendation.primary)}`,
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

  const result = await graphPostJson(
    "api.facebook.com",
    `/${config.whatsappPhoneNumberId}/agent_event`,
    config.wabaToken,
    {
      to: `+${digits}`,
      event: agentEventPayload,
    },
    { "X-API-Version": "2.0.0" }
  );

  try {
    const eventId = `evt_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(formattedPayload);
    } catch (_) {
      parsedPayload = formattedPayload;
    }

    await db.collection("wa_conversations").doc(digits).collection("agent_events").doc(eventId).set({
      id: eventId,
      waId: digits,
      type: event && event.type ? event.type : "unknown",
      description: event && event.description ? event.description : "",
      payload: parsedPayload,
      rawPayload: formattedPayload,
      event: cloneJson(agentEventPayload),
      graphStatus: result && result.status ? result.status : 0,
      graphBody: cloneJson(typeof result.body === "string" ? (() => { try { return JSON.parse(result.body); } catch (_) { return result.body; } })() : result.body),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ts: Date.now(),
    });
    await db.collection("wa_conversations").doc(digits).set({
      waId: digits,
      lastAgentEventType: event && event.type ? event.type : "",
      lastAgentEventAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error("agent_event Firestore write error:", err);
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

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function browserBreakoutHtml(dest) {
  const safe = String(dest).replace(/[<>"]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${safe}">
  <title>Opening recommended partner</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; background:#1f1814; color:#fbf5ef; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; padding:24px; text-align:center; }
    a { color:#d86326; font-weight:700; }
  </style>
</head>
<body>
  <div>
    <p>Opening your recommended partner in the browser…</p>
    <p><a id="continue" href="${safe}" rel="noopener noreferrer">Tap here if it does not open</a></p>
  </div>
  <script>
    (function () {
      var url = ${JSON.stringify(dest)};
      var ua = navigator.userAgent || "";
      if (/Android/i.test(ua)) {
        var path = url.replace(/^https?:\\/\\//, "");
        window.location.replace("intent://" + path + "#Intent;scheme=https;action=android.intent.action.VIEW;end");
      }
      window.location.replace(url);
    })();
  </script>
</body>
</html>`;
}

async function logOfferClick(req, fields) {
  const ip = getClientIp(req);
  const clickId = fields.clickId;
  const record = {
    clickId,
    slug: fields.slug || "",
    partnerId: fields.partnerId || "",
    destinationUrl: fields.destinationUrl || "",
    ip,
    userAgent: req.get("user-agent") || "",
    referer: req.get("referer") || "",
    source: fields.source || "web",
    sid: fields.sid || "",
    fbclid: getQueryValue(req, "fbclid") || "",
    waId: String(getQueryValue(req, "wa") || "").replace(/\D/g, ""),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const writes = [db.collection("offer_clicks").add(record)];
    if (clickId) {
      writes.push(db.collection("clicks").doc(clickId).set({
        ip,
        userAgent: record.userAgent,
        partner: record.partnerId,
        slug: record.slug,
        destinationUrl: record.destinationUrl,
        source: record.source,
        sid: record.sid || "",
        lastOfferClickAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error("offer_clicks write error:", err);
  }

  sendMetaCapiEvent(
    "InitiateCheckout",
    `offerclick_${clickId}_${Date.now()}`,
    {
      client_ip_address: ip,
      client_user_agent: record.userAgent,
      external_id: clickId,
      ...(getQueryValue(req, "fbclid")
        ? { fbc: `fb.1.${Date.now()}.${getQueryValue(req, "fbclid")}` }
        : {}),
    },
    {
      content_name: `Offer click ${record.slug || record.partnerId}`,
      content_category: "VPN",
      content_ids: [record.partnerId || record.slug],
      content_type: "product",
    },
    `https://ascendantlabs.co/r/${record.slug || "vpn"}`
  ).catch((err) => console.warn("Offer click CAPI error:", err));
}

/**
 * First-party short links for partner offers.
 * Used in WhatsApp as plain URLs so they can leave the in-app CTA webview.
 * Keep a warm instance so CTA taps are not waiting on a cold start.
 */
exports.affiliateRedirect = onRequest({ minInstances: 1, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const raw = String(req.originalUrl || req.url || req.path || "");
  const parts = raw.split("?")[0].split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  const sid = getQueryValue(req, "sid") || getQueryValue(req, "s") || "";
  const ua = req.get("user-agent") || "";
  const source = /WhatsApp/i.test(ua) ? "whatsapp" : (getQueryValue(req, "utm_source") || "web");
  const clickId =
    getQueryValue(req, "c") ||
    getQueryValue(req, "click_id") ||
    sid ||
    getQueryValue(req, "fbclid") ||
    `clk_${crypto.randomBytes(6).toString("hex")}${Date.now().toString(36)}`;

  const dest = buildPartnerUrl(slug, clickId, { source, slug, sid });

  const logP = logOfferClick(req, {
    clickId,
    slug,
    partnerId: slug || "",
    destinationUrl: dest || "",
    source,
    sid,
  }).catch((err) => console.error("offer_clicks write error:", err));

  if (!dest) {
    res.status(404).json({
      error: "Unknown or unconfigured partner link",
      slug,
    });
    await logP;
    return;
  }

  res.set("Cache-Control", "no-store");
  if (/WhatsApp/i.test(ua)) {
    res.status(200).send(browserBreakoutHtml(dest));
  } else {
    res.redirect(302, dest);
  }
  await logP;
});

/**
 * Persist a connection scan and notify Meta Business Agent when a WhatsApp number is known.
 */
exports.completeConnectionScan = onRequest(async (req, res) => {
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

  try {
    await db.collection("connection_scans").doc(sid).set(scan, { merge: true });
    if (waId) {
      await db.collection("wa_conversations").doc(waId).set({
        waId,
        lastSid: sid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (err) {
    console.error("Scan Firestore write error:", err);
  }

  if (waId) {
    await sendAgentEvent(
      waId,
      buildScanCompletedEvent(
        scan,
        recommendation,
        `Connection scan finished for ${scan.city || scan.country || "this user"}. ISP ${scan.isp || "unknown"}, country ${scan.country || "unknown"}. Recommend ${recommendation.primary} first.`
      )
    );
  }

  const returnUrls = buildWhatsAppReturnUrl();
  res.status(200).json({
    success: true,
    sid,
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

exports.getConnectionScan = onRequest(async (req, res) => {
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

exports.whatsappWebhook = onRequest(async (req, res) => {
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

// Export raw logic handlers for testing
exports.handleConversionCreated = handleConversionCreated;
exports.sendMetaCapiEvent = sendMetaCapiEvent;
exports.buildAffiliateUrl = buildAffiliateUrl;
exports.buildScanCompletedEvent = buildScanCompletedEvent;
exports.sendAgentEvent = sendAgentEvent;
exports.sendWhatsAppText = sendWhatsAppText;
exports.storeWaMessage = storeWaMessage;
exports.extractAdContext = extractAdContext;

