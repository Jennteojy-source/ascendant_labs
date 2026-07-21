const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const crypto = require("crypto");
const https = require("https");
const { config, buildAffiliateUrl } = require("./config");

admin.initializeApp();
const db = admin.firestore();

const META_QUERY_PARAMS = [
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ad_id",
  "adset_id",
  "campaign_id",
  "placement",
];

function getClientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "";
}

function extractTrackingParams(query) {
  const tracking = {};
  for (const key of META_QUERY_PARAMS) {
    if (query[key]) {
      tracking[key] = String(query[key]);
    }
  }
  return tracking;
}

function resolveClickId(tracking) {
  if (tracking.fbclid) {
    return tracking.fbclid;
  }
  return crypto.randomUUID();
}

function saveClickAsync(clickId, clickData) {
  return db.collection("clicks").doc(clickId).set(clickData);
}

function saveConversionAsync(transactionId, conversionData) {
  return db.collection("conversions").doc(transactionId).set(conversionData);
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
 * @param {string} eventName - Meta standard event (e.g. "ViewContent", "Purchase")
 * @param {string} eventId - Unique dedup ID for this event
 * @param {object} userData - { fbc, client_ip_address, client_user_agent }
 * @param {object} [customData] - Optional { currency, value, content_name, ... }
 * @param {string} [eventSourceUrl] - The URL where the event occurred
 */
function sendMetaCapiEvent(eventName, eventId, userData, customData = null, eventSourceUrl = "https://ascendantlabs.co/r/nordvpn") {
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
    path: `/v19.0/${config.datasetId}/events?access_token=${config.capiAccessToken}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
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

exports.redirectNordVpn = onRequest(async (req, res) => {
  const tracking = extractTrackingParams(req.query);
  const clickId = resolveClickId(tracking);
  const redirectUrl = buildAffiliateUrl(clickId);
  const ip = getClientIp(req);
  const userAgent = req.get("user-agent") || "";

  const clickData = {
    clickId,
    partner: config.networkId,
    offerId: Number(config.nordVpn.offerId),
    tracking,
    ip,
    userAgent,
    referrer: req.get("referer") || req.get("referrer") || "",
    landingPath: req.path || "/r/nordvpn",
    query: req.query,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // Only await the Firestore write to keep the redirect extremely fast (~30-50ms)
    await saveClickAsync(clickId, clickData);
  } catch (error) {
    console.error("Error in redirectNordVpn save:", error);
  }

  res.redirect(302, redirectUrl);
});

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

    // Save conversion to Firestore and let the trigger process CAPI Purchase
    await saveConversionAsync(transactionId, conversionData);
    console.log(`Successfully logged conversion ${transactionId} for click ${clickId}`);
    res.status(200).send("success");
  } catch (error) {
    console.error("Error in nordVpnWebhook:", error);
    res.status(500).send("Internal Server Error");
  }
});

async function handleRedirectClickCreated(clickId, clickData) {
  if (!clickData) return;
  const tracking = clickData.tracking || {};
  const creationTime = clickData.timestamp
    ? Math.floor(clickData.timestamp.toDate().getTime())
    : Date.now();

  // Only construct fbc if the click originated from Facebook (real fbclid exists)
  const fbc = tracking.fbclid ? `fb.1.${creationTime}.${tracking.fbclid}` : undefined;

  try {
    await sendMetaCapiEvent(
      "ViewContent",
      `vc_${clickId}`,
      {
        fbc,
        client_ip_address: clickData.ip || "",
        client_user_agent: clickData.userAgent || "",
      },
      {
        content_name: "NordVPN",
        content_category: "VPN",
      },
      `https://ascendantlabs.co${clickData.landingPath || "/r/nordvpn"}`
    );
  } catch (error) {
    console.error(`Error sending ViewContent CAPI for click ${clickId}:`, error);
  }
}

async function handleConversionCreated(transactionId, conversionData) {
  if (!conversionData) return;
  const clickId = conversionData.clickId;

  // Look up original click to get user context for CAPI
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

  // Only build fbc if the original click had a real fbclid from a Facebook ad
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
      "https://ascendantlabs.co/r/nordvpn"
    );
  } catch (error) {
    console.error(`Error sending Purchase CAPI for transaction ${transactionId}:`, error);
  }
}

exports.onRedirectClickCreated = onDocumentCreated("clicks/{clickId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the click event");
    return;
  }
  await handleRedirectClickCreated(event.params.clickId, snapshot.data());
});

exports.onConversionCreated = onDocumentCreated("conversions/{transactionId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the conversion event");
    return;
  }
  await handleConversionCreated(event.params.transactionId, snapshot.data());
});

// Export raw logic handlers for testing
exports.handleRedirectClickCreated = handleRedirectClickCreated;
exports.handleConversionCreated = handleConversionCreated;

