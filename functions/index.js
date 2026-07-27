const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { config, buildAffiliateUrl } = require("./config");

admin.initializeApp();
const db = admin.firestore();

function getClientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "";
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
      ...(userData.external_id ? { external_id: userData.external_id } : {}),
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

  // Pass through _fbc and _fbp cookies from client (set by Meta Pixel). Never reconstruct.
  const fbc = body.fbc || null;
  const fbp = body.fbp || null;

  // Store only what the Purchase CAPI handler needs to look up later.
  try {
    await db.collection("clicks").doc(clickId).set({
      ip,
      userAgent,
      ...(fbc ? { fbc } : {}),
      ...(fbp ? { fbp } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error("Firestore click write error:", err);
  }

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
      customData,
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
      getQueryValue(req, "aff_sub");
    const transactionId = getQueryValue(req, "transaction_id");
    const payout = parseFloat(getQueryValue(req, "payout")) || 0;
    const offerId = parseInt(getQueryValue(req, "offer_id"), 10) || Number(config.nordVpn.offerId);
    const saleAmount = parseFloat(getQueryValue(req, "sale_amount")) || 0;
    const currency = getQueryValue(req, "currency");
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

// Export raw logic handlers for testing
exports.handleConversionCreated = handleConversionCreated;
exports.sendMetaCapiEvent = sendMetaCapiEvent;
