const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { buildPartnerUrl } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, getQueryValue, cors, WARM_HTTP } = require("../lib/http");
const { sendMetaCapiEvent, sendWhatsAppCapiEvent } = require("../lib/capi");

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

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

async function resolveOfferAttribution({ waId, sid }) {
  let resolvedWaId = digitsOnly(waId);
  let scan = {};

  if (!resolvedWaId && sid) {
    try {
      const scanDoc = await db.collection("connection_scans").doc(sid).get();
      if (scanDoc.exists) {
        scan = scanDoc.data() || {};
        resolvedWaId = digitsOnly(scan.waId);
      }
    } catch (err) {
      console.error("offer attribution scan lookup error:", err);
    }
  }

  if (!resolvedWaId) {
    return {
      waId: "",
      ctwaClid: String(scan.ctwaClid || ""),
      adId: String(scan.adId || ""),
      sourceUrl: String(scan.sourceUrl || ""),
    };
  }

  try {
    const convoDoc = await db.collection("wa_conversations").doc(resolvedWaId).get();
    const convo = convoDoc.exists ? convoDoc.data() || {} : {};
    return {
      waId: resolvedWaId,
      ctwaClid: String(convo.ctwaClid || scan.ctwaClid || ""),
      adId: String(convo.adId || scan.adId || ""),
      sourceUrl: String(convo.sourceUrl || scan.sourceUrl || ""),
    };
  } catch (err) {
    console.error("offer attribution conversation lookup error:", err);
    return {
      waId: resolvedWaId,
      ctwaClid: String(scan.ctwaClid || ""),
      adId: String(scan.adId || ""),
      sourceUrl: String(scan.sourceUrl || ""),
    };
  }
}

function capiResultFields(result, eventName) {
  const body = result && result.body && typeof result.body === "object" ? result.body : {};
  const graphError = body.error && typeof body.error === "object" ? body.error : null;
  return {
    eventName,
    status: result && result.status ? result.status : 0,
    ok: !!(result && result.ok),
    skipped: !!(result && result.skipped),
    eventsReceived: Number(body.events_received || 0),
    fbtraceId: String(body.fbtrace_id || (graphError && graphError.fbtrace_id) || ""),
    errorCode: graphError && graphError.code ? graphError.code : null,
    errorSubcode: graphError && graphError.error_subcode ? graphError.error_subcode : null,
    errorMessage: String((graphError && graphError.message) || (result && result.error) || ""),
  };
}

async function logOfferClick(req, fields) {
  const ip = getClientIp(req);
  const clickId = fields.clickId;
  const attribution = await resolveOfferAttribution({
    waId: fields.waId || getQueryValue(req, "wa"),
    sid: fields.sid,
  });
  const offerClickId = fields.offerClickId || `offer_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
  const clickedAt = Number(fields.clickedAt || Date.now());
  const canTrackConversion = !!(fields.destinationUrl && attribution.ctwaClid);
  const record = {
    id: offerClickId,
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
    waId: attribution.waId,
    ctwaClid: attribution.ctwaClid,
    adId: attribution.adId,
    adSourceUrl: attribution.sourceUrl,
    ctwaAttributed: !!attribution.ctwaClid,
    clickedAt,
    whatsappCapiEventId: canTrackConversion ? `ctwa_${offerClickId}` : "",
    whatsappCapiState: canTrackConversion ? "sending" : "skipped_no_ctwa_clid",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  const offerRef = db.collection("offer_clicks").doc(offerClickId);
  const writes = [offerRef.set(record, { merge: true })];
  if (clickId) {
    writes.push(db.collection("clicks").doc(clickId).set({
      ip,
      userAgent: record.userAgent,
      partner: record.partnerId,
      slug: record.slug,
      destinationUrl: record.destinationUrl,
      source: record.source,
      sid: record.sid,
      waId: record.waId,
      ctwaClid: record.ctwaClid,
      adId: record.adId,
      lastOfferClickId: offerClickId,
      lastOfferClickAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }));
  }

  const webCapiPromise = fields.destinationUrl
    ? sendMetaCapiEvent(
      "InitiateCheckout",
      `web_${offerClickId}`,
      {
        client_ip_address: ip,
        client_user_agent: record.userAgent,
        external_id: clickId,
        ...(record.fbclid ? { fbc: `fb.1.${clickedAt}.${record.fbclid}` } : {}),
      },
      {
        content_name: `Offer click ${record.slug || record.partnerId}`,
        content_category: "VPN",
        content_ids: [record.partnerId || record.slug],
        content_type: "product",
      },
      `https://ascendantlabs.co/r/${record.slug || "vpn"}`
    )
    : Promise.resolve({ skipped: true, status: 0, body: null });

  const whatsappCapiPromise = canTrackConversion
    ? sendWhatsAppCapiEvent({
      eventName: "LeadSubmitted",
      eventId: record.whatsappCapiEventId,
      eventTime: clickedAt,
      ctwaClid: attribution.ctwaClid,
    })
    : Promise.resolve({ skipped: true, reason: "missing_ctwa_clid", status: 0, body: null });

  const [writesOutcome, webCapiOutcome, whatsappCapiOutcome] = await Promise.allSettled([
    Promise.all(writes),
    webCapiPromise,
    whatsappCapiPromise,
  ]);
  if (writesOutcome.status === "rejected") {
    console.error("offer click Firestore write error:", writesOutcome.reason);
  }
  if (webCapiOutcome.status === "rejected") {
    console.error("website CAPI error:", webCapiOutcome.reason);
  }
  if (whatsappCapiOutcome.status === "rejected") {
    console.error("WhatsApp CAPI error:", whatsappCapiOutcome.reason);
  }

  const webCapiResult = webCapiOutcome.status === "fulfilled"
    ? webCapiOutcome.value
    : { status: 0, ok: false, error: String(webCapiOutcome.reason || "") };
  const whatsappCapiResult = whatsappCapiOutcome.status === "fulfilled"
    ? whatsappCapiOutcome.value
    : { status: 0, ok: false, error: String(whatsappCapiOutcome.reason || "") };
  const capi = {
    website: capiResultFields(webCapiResult, "InitiateCheckout"),
    whatsapp: capiResultFields(whatsappCapiResult, "LeadSubmitted"),
  };
  try {
    await offerRef.set({
      capi,
      whatsappCapiState: capi.whatsapp.skipped ? record.whatsappCapiState : (capi.whatsapp.ok ? "accepted" : "failed"),
      trackingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error("offer CAPI result write error:", err);
  }

  return { record, capi };
}

/**
 * First-party short links for partner offers.
 * Used in WhatsApp as plain URLs so they can leave the in-app CTA webview.
 * Keep a warm instance so CTA taps are not waiting on a cold start.
 */
const affiliateRedirect = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const raw = String(req.originalUrl || req.url || req.path || "");
  const parts = raw.split("?")[0].split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  const sid = getQueryValue(req, "sid") || getQueryValue(req, "s") || "";
  const waId = digitsOnly(getQueryValue(req, "wa"));
  const ua = req.get("user-agent") || "";
  const source = /WhatsApp/i.test(ua) ? "whatsapp" : (getQueryValue(req, "utm_source") || "web");
  const clickId =
    getQueryValue(req, "c") ||
    getQueryValue(req, "click_id") ||
    sid ||
    getQueryValue(req, "fbclid") ||
    `clk_${crypto.randomBytes(6).toString("hex")}${Date.now().toString(36)}`;
  const clickedAt = Date.now();
  const offerClickId = `offer_${clickedAt}_${crypto.randomBytes(5).toString("hex")}`;

  const dest = buildPartnerUrl(slug, clickId, { source, slug, sid });

  const logP = logOfferClick(req, {
    clickId,
    slug,
    partnerId: slug || "",
    destinationUrl: dest || "",
    source,
    sid,
    waId,
    clickedAt,
    offerClickId,
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


module.exports = {
  affiliateRedirect,
  logOfferClick,
  resolveOfferAttribution,
};
