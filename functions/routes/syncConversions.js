const https = require("https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { config } = require("../config");
const { admin, db } = require("../lib/firebase");
const { cors, WARM_HTTP } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");

function getIsoDate(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Queries Travelpayouts Booking Statistics API for AirHelp (campaign 120) actions
 */
function fetchTravelpayoutsActions(token, daysLookback = 45) {
  const startDate = getIsoDate(daysLookback);
  const reqData = JSON.stringify({
    fields: [
      "action_id",
      "campaign_id",
      "campaign_name_en",
      "state",
      "sub_id",
      "paid_profit_usd",
      "processing_profit_usd",
      "price_usd",
      "date",
      "type",
      "state_updated_at",
      "updated_at",
    ],
    filters: [
      { field: "date", op: "ge", value: startDate },
      { field: "campaign_id", op: "eq", value: 120 },
      { field: "type", op: "eq", value: "action" },
    ],
    limit: 500,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.travelpayouts.com",
      path: "/statistics/v1/execute_query",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(reqData),
        "X-Access-Token": token,
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.results || []);
        } catch (e) {
          reject(new Error(`Travelpayouts JSON parse error: ${e.message}, status: ${res.statusCode}, body: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(12000, () => req.destroy(new Error("Travelpayouts API request timeout")));
    req.write(reqData);
    req.end();
  });
}

/**
 * Evaluates actions against Firestore and pushes conversion signals to Meta CAPI
 */
async function processActions(actions) {
  const summary = {
    total: actions.length,
    processed: 0,
    newEvents: 0,
    skipped: 0,
    errors: 0,
  };

  for (const action of actions) {
    const actionId = String(action.action_id || "");
    const subId = String(action.sub_id || "").trim();
    const state = String(action.state || "").toLowerCase(); // "processing" | "paid" | "cancelled"
    const paidProfit = parseFloat(action.paid_profit_usd || 0);
    const price = parseFloat(action.price_usd || 0);

    if (!actionId) continue;

    summary.processed++;

    try {
      const convRef = db.collection("claim_conversions").doc(actionId);
      const convDoc = await convRef.get();
      const existingData = convDoc.exists ? convDoc.data() : null;

      // Deduplication: Avoid duplicate CAPI calls if this exact state was already sent
      if (existingData && existingData.lastSentState === state) {
        summary.skipped++;
        continue;
      }

      // Look up original click metadata by sub_id
      let clickData = null;
      if (subId) {
        const clickDoc = await db.collection("claim_clicks").doc(subId).get();
        if (clickDoc.exists) {
          clickData = clickDoc.data();
        } else {
          // Fallback lookup in claim_starts
          const startDoc = await db.collection("claim_starts").doc(subId).get();
          if (startDoc.exists) clickData = startDoc.data();
        }
      }

      let capiEventName = null;
      let capiValue = 0;
      if (state === "paid") {
        capiEventName = "Purchase";
        capiValue = paidProfit > 0 ? paidProfit : (price > 0 ? price * 0.25 : 25.0);
      } else if (state === "processing") {
        capiEventName = "SubmitApplication";
        capiValue = 0;
      }

      let capiResult = null;
      if (capiEventName) {
        const eventId = `tp_${actionId}_${state}`;
        const userData = {
          client_ip_address: clickData?.ip || "",
          client_user_agent: clickData?.userAgent || "",
          external_id: subId || actionId,
          ...(clickData?.fbp ? { fbp: clickData.fbp } : {}),
          ...(clickData?.fbc ? { fbc: clickData.fbc } : {}),
        };
        const customData = {
          content_name: `${clickData?.originIata || "FLIGHT"}-${clickData?.destIata || "CLAIM"} (${state})`,
          content_category: "Flight Delay Compensation Claim",
          currency: "USD",
          value: capiValue,
          status: state,
        };

        capiResult = await sendMetaCapiEvent(
          capiEventName,
          eventId,
          userData,
          customData,
          "https://funnel.airhelp.com/claims"
        );
        summary.newEvents++;
        console.log(`[Conversion Sync] Sent Meta CAPI [${capiEventName}] for action ${actionId} (state: ${state})`);
      }

      // Record in Firestore claim_conversions
      await convRef.set({
        actionId,
        subId,
        campaignId: action.campaign_id,
        state,
        lastSentState: state,
        paidProfitUsd: paidProfit,
        priceUsd: price,
        date: action.date,
        type: action.type,
        matchedClick: Boolean(clickData),
        clickOrigin: clickData?.originIata || "",
        clickDest: clickData?.destIata || "",
        disruptionType: clickData?.disruptionType || "",
        capiEventSent: capiEventName,
        capiResult: capiResult?.ok || false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    } catch (err) {
      summary.errors++;
      console.error(`[Conversion Sync] Error processing action ${actionId}:`, err);
    }
  }

  return summary;
}

/**
 * Hourly Cron Job: queries Travelpayouts every hour, stores to Firestore, sends to CAPI
 */
const syncConversionsCron = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "UTC",
    retryCount: 2,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    console.log("[Conversion Sync Cron] Starting hourly Travelpayouts conversion check...");
    const token = config.travelPayoutToken;
    if (!token) {
      console.warn("[Conversion Sync Cron] Missing TRAVEL_PAYOUT token, skipping.");
      return;
    }
    try {
      const actions = await fetchTravelpayoutsActions(token, 45);
      console.log(`[Conversion Sync Cron] Fetched ${actions.length} action(s) from Travelpayouts.`);
      const summary = await processActions(actions);
      console.log("[Conversion Sync Cron] Sync completed:", summary);
    } catch (err) {
      console.error("[Conversion Sync Cron] Execution failed:", err);
    }
  }
);

/**
 * Manual HTTP Endpoint: allows on-demand triggering or webhook testing
 */
const syncConversionsHttp = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  const token = config.travelPayoutToken;
  if (!token) {
    res.status(500).json({ error: "Missing TRAVEL_PAYOUT token in environment" });
    return;
  }
  try {
    const days = parseInt(req.query.days || "45", 10);
    const actions = await fetchTravelpayoutsActions(token, days);
    const summary = await processActions(actions);
    res.status(200).json({
      ok: true,
      actionsCount: actions.length,
      summary,
    });
  } catch (err) {
    console.error("[Conversion Sync HTTP] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = {
  syncConversionsCron,
  syncConversionsHttp,
  fetchTravelpayoutsActions,
  processActions,
};
