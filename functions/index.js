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

function sendAgentEvent(to, event) {
  if (!config.wabaToken || !config.whatsappPhoneNumberId || !to) {
    return Promise.resolve({ skipped: true });
  }
  const digits = String(to).replace(/\D/g, "");
  return graphPostJson(
    "api.facebook.com",
    `/${config.whatsappPhoneNumberId}/agent_event`,
    config.wabaToken,
    {
      to: `+${digits}`,
      event,
    },
    { "X-API-Version": "2.0.0" }
  );
}

function buildWhatsAppReturnUrl(scan) {
  const phone = config.whatsappDisplayNumber;
  const lines = [
    "SCAN_COMPLETE",
    `sid:${scan.sid}`,
    scan.country ? `country:${scan.country}` : null,
    scan.city ? `city:${scan.city}` : null,
    scan.isp ? `isp:${scan.isp}` : null,
    scan.ip ? `ip:${scan.ip}` : null,
    scan.device ? `device:${scan.device}` : null,
  ].filter(Boolean);
  const text = encodeURIComponent(lines.join("\n"));
  return {
    waMe: `https://wa.me/${phone}?text=${text}`,
    deepLink: `whatsapp://send?phone=${phone}&text=${text}`,
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
  const safe = String(dest).replace(/</g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
        window.location.href = "intent://" + path + "#Intent;scheme=https;action=android.intent.action.VIEW;end";
        setTimeout(function () { window.location.href = url; }, 700);
        return;
      }
      window.location.href = url;
    })();
  </script>
</body>
</html>`;
}

/**
 * First-party short links for partner offers.
 * Used in WhatsApp as plain URLs so they can leave the in-app CTA webview.
 */
exports.affiliateRedirect = onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const raw = String(req.originalUrl || req.url || req.path || "");
  const parts = raw.split("?")[0].split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  const clickId =
    getQueryValue(req, "c") ||
    getQueryValue(req, "click_id") ||
    getQueryValue(req, "fbclid") ||
    "";
  const dest = buildPartnerUrl(slug, clickId);

  if (!dest) {
    res.status(404).json({
      error: "Unknown or unconfigured partner link",
      slug,
    });
    return;
  }

  const ua = req.get("user-agent") || "";
  if (/WhatsApp/i.test(ua)) {
    res.set("Cache-Control", "no-store");
    res.status(200).send(browserBreakoutHtml(dest));
    return;
  }

  res.set("Cache-Control", "no-store");
  res.redirect(302, dest);
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
    const event = {
      type: "connection_scan_completed",
      description: `Connection scan finished for ${scan.city || scan.country || "this user"}. ISP ${scan.isp || "unknown"}, country ${scan.country || "unknown"}. Recommend ${recommendation.primary} first.`,
      payload: {
        sid,
        ip: scan.ip,
        city: scan.city,
        country: scan.country,
        isp: scan.isp,
        device: scan.device,
        primary: recommendation.primary,
        alternative: recommendation.alternative,
        password: recommendation.password,
        angle: recommendation.angle,
        primary_link: recommendation.shortLinks.primary,
        alternative_link: recommendation.shortLinks.alternative,
        password_link: recommendation.shortLinks.password,
      },
    };
    await sendAgentEvent(waId, event);
  }

  const returnUrls = buildWhatsAppReturnUrl(scan);
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
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const message of messages) {
          const from = String(message.from || "").replace(/\D/g, "");
          const text = (message.text && message.text.body) || "";
          const sid = extractScanSid(text);
          if (!from) continue;

          const convo = {
            waId: from,
            lastMessage: text.slice(0, 500),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          if (sid) convo.lastSid = sid;
          await db.collection("wa_conversations").doc(from).set(convo, { merge: true });

          if (sid) {
            const scanDoc = await db.collection("connection_scans").doc(sid).get();
            if (scanDoc.exists) {
              const scan = scanDoc.data() || {};
              await db.collection("connection_scans").doc(sid).set({ waId: from }, { merge: true });
              const recommendation = scan.recommendation || recommendFromScan(scan);
              await sendAgentEvent(from, {
                type: "connection_scan_completed",
                description: `User returned from connection scan ${sid}. ISP ${scan.isp || "unknown"} in ${scan.country || "unknown"}.`,
                payload: {
                  sid,
                  ip: scan.ip,
                  city: scan.city,
                  country: scan.country,
                  isp: scan.isp,
                  device: scan.device,
                  primary: recommendation.primary,
                  alternative: recommendation.alternative,
                  password: recommendation.password,
                  angle: recommendation.angle,
                  primary_link: recommendation.shortLinks?.primary,
                  alternative_link: recommendation.shortLinks?.alternative,
                  password_link: recommendation.shortLinks?.password,
                },
              });
            }
          }
        }
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
exports.sendAgentEvent = sendAgentEvent;
exports.sendWhatsAppText = sendWhatsAppText;
