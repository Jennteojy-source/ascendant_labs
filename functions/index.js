const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
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

function saveClickAsync(clickData) {
  return db.collection("clicks").add(clickData);
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
    const writePromise = saveClickAsync(clickData);
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
      return res.status(400).json({ error: "Missing transaction_id" });
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

    await saveConversionAsync(transactionId, conversionData);
    console.log(`Logged conversion ${transactionId} for click ${clickId}`);
    return res.status(200).send("success");
  } catch (error) {
    console.error("Error in nordVpnWebhook:", error);
    return res.status(500).json({ error: error.message });
  }
});
