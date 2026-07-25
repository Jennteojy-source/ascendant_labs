const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");
const https = require("https");
const { config, buildAffiliateUrl } = require("./config");
const geoip = require("geoip-lite");

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
    path: `/v21.0/${config.datasetId}/events`,
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

const ispCache = new Map();

function resolveIspServerSide(ip, req) {
  const headerIsp = req.get("cf-asorganization") || req.get("x-isp") || req.get("x-organization");
  if (headerIsp) return Promise.resolve(headerIsp);

  if (!ip || ip === "127.0.0.1" || ip === "::1") {
    return Promise.resolve("Your Internet Provider");
  }

  if (ispCache.has(ip)) {
    return Promise.resolve(ispCache.get(ip));
  }

  return new Promise((resolve) => {
    const request = https.get(`https://ip-api.com/json/${ip}?fields=isp,org,as`, { timeout: 1500 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const ispName = parsed.isp || parsed.org || parsed.as || "Your Internet Provider";
          ispCache.set(ip, ispName);
          resolve(ispName);
        } catch (e) {
          resolve("Your Internet Provider");
        }
      });
    });

    request.on("error", () => resolve("Your Internet Provider"));
    request.on("timeout", () => {
      request.destroy();
      resolve("Your Internet Provider");
    });
  });
}

/**
 * Native, zero-dependency client IP & Geolocation endpoint.
 */
exports.getIpTelemetry = onRequest(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const rawIp = getClientIp(req) || "103.252.19.45";
  let displayIp = rawIp;

  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rawIp.trim())) {
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
    displayIp = `${b1}.${b2}.${b3}.${b4}`;
  }

  const geo = geoip.lookup(rawIp);
  const city = geo?.city || "Detected City";
  const country = geo?.country || "";
  const isp = await resolveIspServerSide(rawIp, req);

  res.set("Cache-Control", "no-store");
  res.status(200).json({
    ip: displayIp,
    city: city,
    country: country,
    isp: isp,
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
  const now = Date.now();

  const fbclid = trackingParams.fbclid || (clickId.startsWith("clk_") ? null : clickId);
  const fbc = fbclid ? `fb.1.${now}.${fbclid}` : undefined;

  const answers = customData.answers || body.answers || null;
  const riskScore = customData.risk_score || body.risk_score || null;

  const clickData = {
    clickId,
    partner: config.networkId,
    offerId: Number(config.nordVpn.offerId),
    tracking: trackingParams,
    ip,
    userAgent,
    referrer: req.get("referer") || req.get("referrer") || "",
    landingPath: "/nordvpn/quiz",
    lastEvent: eventName,
    ...(answers ? { answers } : {}),
    ...(riskScore !== null ? { riskScore } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // 1. Update main click session doc in Firestore
    await db.collection("clicks").doc(clickId).set(clickData, { merge: true });

    // 2. Log raw event record in Firestore 'quiz_events' collection
    await db.collection("quiz_events").add({
      clickId,
      eventName,
      answers: answers || null,
      riskScore: riskScore !== null ? riskScore : null,
      trackingParams,
      ip,
      userAgent,
      eventSourceUrl,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3. Log raw quiz submission with selected answers in Firestore 'quiz_submissions' collection
    if (answers || eventName === "CompleteRegistration") {
      await db.collection("quiz_submissions").doc(clickId).set({
        clickId,
        answers,
        riskScore,
        eventName,
        trackingParams,
        ip,
        userAgent,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (err) {
    console.error("Firestore logging error in trackQuizEvent:", err);
  }

  try {
    await sendMetaCapiEvent(
      eventName,
      eventId,
      {
        fbc,
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
  const apiKey = getQueryValue(req, "key") || req.get("x-api-key") || "";
  if (apiKey !== config.webhookApiKey) {
    console.warn("Unauthorized webhook request: invalid key");
    res.status(401).send("Unauthorized");
    return;
  }

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

  let fbc = undefined;
  if (clickDocData?.tracking?.fbclid) {
    const creationTime = clickDocData.timestamp
      ? Math.floor(clickDocData.timestamp.toDate().getTime())
      : Date.now();
    fbc = `fb.1.${creationTime}.${clickDocData.tracking.fbclid}`;
  }

  try {
    await sendMetaCapiEvent(
      "Purchase",
      transactionId,
      {
        fbc,
        client_ip_address: clickDocData?.ip || "",
        client_user_agent: clickDocData?.userAgent || "",
      },
      {
        currency: "USD",
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
