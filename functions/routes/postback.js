const { onRequest } = require("firebase-functions/v2/https");
const { admin, db } = require("../lib/firebase");
const { getClientIp, cors, WARM_HTTP } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");

/**
 * Travelpayouts S2S Postback Webhook Endpoint
 * Receives conversion & claim status updates from Travelpayouts (Brand 120: AirHelp)
 * and relays verified conversion signals to Meta Conversions API (CAPI).
 */
const travelpayoutsPostback = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Accept both GET and POST requests from Travelpayouts postback engine
  const data = req.method === "POST" ? (req.body || {}) : (req.query || {});
  
  const actionId = String(data.action_id || data.actionId || data.id || `act_${Date.now()}`);
  const clickId = String(data.click_id || data.sub_id || data.data1 || "").trim();
  const campaignId = String(data.campaign_id || data.campaignId || "120");
  const status = String(data.status || "pending").toLowerCase(); // pending | paid | cancelled
  const payout = parseFloat(data.payout || data.revenue || "0") || 0;
  const currency = String(data.currency || "USD").toUpperCase();

  console.log(`[Travelpayouts Postback] Received: action=${actionId}, clickId=${clickId}, status=${status}, payout=${payout} ${currency}`);

  // 1. Retrieve original click data from Firestore to match Meta fbc/fbp cookies & IP
  let clickData = null;
  if (clickId) {
    try {
      const clickDoc = await db.collection("claim_clicks").doc(clickId).get();
      if (clickDoc.exists) {
        clickData = clickDoc.data();
      }
    } catch (err) {
      console.warn("[Travelpayouts Postback] Error fetching clickDoc:", err.message);
    }
  }

  // 2. Persist conversion record in Firestore
  const conversionRecord = {
    actionId,
    clickId,
    campaignId,
    status,
    payout,
    currency,
    rawPayload: data,
    matchedClick: Boolean(clickData),
    fbc: clickData?.fbc || "",
    fbp: clickData?.fbp || "",
    originIata: clickData?.originIata || "",
    destIata: clickData?.destIata || "",
    disruptionType: clickData?.disruptionType || "",
    ip: getClientIp(req),
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("claim_conversions").doc(actionId).set(conversionRecord, { merge: true });

  // 3. Relay attribution signal to Meta Conversions API (CAPI)
  let capiEventName = null;
  let customData = {
    content_category: "Flight Delay Compensation Claim",
    status: status,
  };

  if (status === "paid") {
    capiEventName = "Purchase";
    customData.value = payout > 0 ? payout : 25.0;
    customData.currency = currency;
  } else if (status === "pending" || status === "processing" || status === "submitted") {
    capiEventName = "SubmitApplication";
    customData.value = 0;
    customData.currency = currency;
  }

  if (capiEventName) {
    const eventId = `tp_${actionId}_${status}`;
    const userData = {
      client_ip_address: clickData?.ip || getClientIp(req),
      client_user_agent: clickData?.userAgent || req.get("user-agent") || "",
      external_id: clickId || actionId,
      ...(clickData?.fbp ? { fbp: clickData.fbp } : {}),
      ...(clickData?.fbc ? { fbc: clickData.fbc } : {}),
    };

    try {
      await sendMetaCapiEvent(
        capiEventName,
        eventId,
        userData,
        customData,
        "https://funnel.airhelp.com/claims"
      );
      console.log(`[Travelpayouts Postback] Successfully sent Meta CAPI event: ${capiEventName} for action ${actionId}`);
    } catch (capiErr) {
      console.error("[Travelpayouts Postback] Meta CAPI send error:", capiErr.message);
    }
  }

  res.status(200).json({
    ok: true,
    actionId,
    status,
    matchedClick: Boolean(clickData),
    capiEventSent: Boolean(capiEventName),
  });
});

module.exports = {
  travelpayoutsPostback,
};
