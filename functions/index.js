const { onRequest } = require("firebase-functions/v2/https");
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

function sendMetaCapiEvent(clickId, conversionData, clickDocData = null) {
  if (!config.datasetId || !config.capiAccessToken) {
    console.log("Meta CAPI skip: missing dataset ID or access token");
    return Promise.resolve();
  }

  const timestampSec = Math.floor(Date.now() / 1000);
  
  // Format fbc: fb.1.creationTime.fbclid
  let fbc = "";
  if (clickId) {
    const creationTime = clickDocData?.timestamp 
      ? Math.floor(clickDocData.timestamp.toDate().getTime())
      : Date.now();
    fbc = `fb.1.${creationTime}.${clickId}`;
  }

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: timestampSec,
        event_id: conversionData.transactionId,
        action_source: "website",
        event_source_url: "https://ascendantlabs.co/r/nordvpn",
        user_data: {
          client_ip_address: clickDocData?.ip || "",
          client_user_agent: clickDocData?.userAgent || "",
          fbc: fbc || undefined
        },
        custom_data: {
          currency: "USD",
          value: conversionData.saleAmount || conversionData.payout || 0
        }
      }
    ]
  };

  const postData = JSON.stringify(payload);
  const options = {
    hostname: "graph.facebook.com",
    path: `/v19.0/${config.datasetId}/events?access_token=${config.capiAccessToken}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`Meta CAPI response: status ${res.statusCode}, body: ${body}`);
        resolve();
      });
    });

    req.on("error", (e) => {
      console.error(`Meta CAPI error: ${e.message}`);
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

  const clickData = {
    clickId,
    partner: config.networkId,
    offerId: Number(config.nordVpn.offerId),
    tracking,
    ip: getClientIp(req),
    userAgent: req.get("user-agent") || "",
    referrer: req.get("referer") || req.get("referrer") || "",
    landingPath: req.path || "/r/nordvpn",
    query: req.query,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const writePromise = saveClickAsync(clickId, clickData);
    res.redirect(302, redirectUrl);
    await writePromise;
  } catch (error) {
    console.error("Error in redirectNordVpn:", error);
    if (!res.headersSent) {
      res.redirect(302, redirectUrl);
    }
  }
});

exports.nordVpnWebhook = onRequest(async (req, res) => {
  // Respond immediately to prevent blocking TUNE
  res.status(200).send("success");

  try {
    const clickId =
      getQueryValue(req, "click_id") ||
      getQueryValue(req, "aff_click_id") ||
      getQueryValue(req, "aff_sub");
    const transactionId = getQueryValue(req, "transaction_id");
    const payout = parseFloat(getQueryValue(req, "payout")) || 0;
    const offerId = parseInt(getQueryValue(req, "offer_id"), 10) || Number(config.nordVpn.offerId);
    const saleAmount = parseFloat(getQueryValue(req, "sale_amount")) || 0;

    if (!transactionId) {
      console.warn("Conversion warning: Missing transaction_id");
      return;
    }

    const conversionData = {
      clickId,
      partner: config.networkId,
      transactionId,
      payout,
      offerId,
      saleAmount,
      rawQuery: req.query,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    let clickDocData = null;
    if (clickId) {
      try {
        const clickDoc = await db.collection("clicks").doc(clickId).get();
        if (clickDoc.exists) {
          clickDocData = clickDoc.data();
        }
      } catch (err) {
        console.error("Firestore read error:", err);
      }
    }

    await Promise.all([
      saveConversionAsync(transactionId, conversionData),
      sendMetaCapiEvent(clickId, conversionData, clickDocData)
    ]);
    console.log(`Successfully processed conversion ${transactionId} for click ${clickId}`);
  } catch (error) {
    console.error("Error in background task for nordVpnWebhook:", error);
  }
});
