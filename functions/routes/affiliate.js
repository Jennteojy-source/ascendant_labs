const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { buildPartnerUrl } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, getQueryValue, cors, WARM_HTTP } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");

function browserBreakoutHtml(dest) {
  const safe = String(dest).replace(/[<>"]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${safe}">
  <title>Opening Offer</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; background:#111; color:#eee; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; padding:24px; text-align:center; }
    a { color:#ff6b35; font-weight:700; }
  </style>
</head>
<body>
  <div>
    <p>Opening offer...</p>
    <p><a id="continue" href="${safe}" rel="noopener noreferrer">Tap here if it does not open automatically</a></p>
  </div>
  <script>
    (function () {
      var url = ${JSON.stringify(dest)};
      window.location.replace(url);
    })();
  </script>
</body>
</html>`;
}

async function logOfferClick(req, fields) {
  const ip = getClientIp(req);
  const clickId = fields.clickId;
  const offerClickId = fields.offerClickId || `offer_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
  const clickedAt = Number(fields.clickedAt || Date.now());

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
    fbclid: getQueryValue(req, "fbclid") || "",
    clickedAt,
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
        content_category: "Affiliate",
        content_ids: [record.partnerId || record.slug],
        content_type: "product",
      },
      `https://ascendantlabs.co/r/${record.slug}`
    )
    : Promise.resolve({ skipped: true, status: 0, body: null });

  try {
    await Promise.allSettled([...writes, webCapiPromise]);
  } catch (err) {
    console.error("Error logging offer click:", err);
  }

  return { record };
}

/**
 * First-party short links for affiliate partner offers.
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
  const ua = req.get("user-agent") || "";
  const source = getQueryValue(req, "utm_source") || "web";
  const clickId =
    getQueryValue(req, "c") ||
    getQueryValue(req, "click_id") ||
    getQueryValue(req, "tid") ||
    getQueryValue(req, "fbclid") ||
    `clk_${crypto.randomBytes(6).toString("hex")}${Date.now().toString(36)}`;
  const clickedAt = Date.now();
  const offerClickId = `offer_${clickedAt}_${crypto.randomBytes(5).toString("hex")}`;

  const dest = buildPartnerUrl(slug, clickId, { source, slug, query: req.query });

  const logP = logOfferClick(req, {
    clickId,
    slug,
    partnerId: slug || "",
    destinationUrl: dest || "",
    source,
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
};
