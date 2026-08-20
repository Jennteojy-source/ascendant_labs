const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const crypto = require("crypto");
const { config } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, getQueryValue } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");
const { resolveIpInfo, formatDisplayIp } = require("../lib/ip");

/**
 * /api/telemetry — Native IP & Geo endpoint.
 * Returns { ip, city, district, region, country, isp } with accurate detection.
 * If lookup fails or times out, returns null fields so the frontend can hide them.
 */
const getIpTelemetry = onRequest(async (req, res) => {
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
const trackQuizEvent = onRequest(async (req, res) => {
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
const nordVpnWebhook = onRequest(async (req, res) => {

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

const onConversionCreated = onDocumentCreated("conversions/{transactionId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the conversion event");
    return;
  }
  await handleConversionCreated(event.params.transactionId, snapshot.data());
});


module.exports = {
  getIpTelemetry,
  trackQuizEvent,
  nordVpnWebhook,
  handleConversionCreated,
  onConversionCreated,
};
