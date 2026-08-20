const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { buildPartnerUrl } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, getQueryValue, cors } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");

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

async function logOfferClick(req, fields) {
  const ip = getClientIp(req);
  const clickId = fields.clickId;
  const record = {
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
    waId: String(getQueryValue(req, "wa") || "").replace(/\D/g, ""),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const writes = [db.collection("offer_clicks").add(record)];
    if (clickId) {
      writes.push(db.collection("clicks").doc(clickId).set({
        ip,
        userAgent: record.userAgent,
        partner: record.partnerId,
        slug: record.slug,
        destinationUrl: record.destinationUrl,
        source: record.source,
        sid: record.sid || "",
        lastOfferClickAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error("offer_clicks write error:", err);
  }

  sendMetaCapiEvent(
    "InitiateCheckout",
    `offerclick_${clickId}_${Date.now()}`,
    {
      client_ip_address: ip,
      client_user_agent: record.userAgent,
      external_id: clickId,
      ...(getQueryValue(req, "fbclid")
        ? { fbc: `fb.1.${Date.now()}.${getQueryValue(req, "fbclid")}` }
        : {}),
    },
    {
      content_name: `Offer click ${record.slug || record.partnerId}`,
      content_category: "VPN",
      content_ids: [record.partnerId || record.slug],
      content_type: "product",
    },
    `https://ascendantlabs.co/r/${record.slug || "vpn"}`
  ).catch((err) => console.warn("Offer click CAPI error:", err));
}

/**
 * First-party short links for partner offers.
 * Used in WhatsApp as plain URLs so they can leave the in-app CTA webview.
 * Keep a warm instance so CTA taps are not waiting on a cold start.
 */
const affiliateRedirect = onRequest({ minInstances: 1, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const raw = String(req.originalUrl || req.url || req.path || "");
  const parts = raw.split("?")[0].split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  const sid = getQueryValue(req, "sid") || getQueryValue(req, "s") || "";
  const ua = req.get("user-agent") || "";
  const source = /WhatsApp/i.test(ua) ? "whatsapp" : (getQueryValue(req, "utm_source") || "web");
  const clickId =
    getQueryValue(req, "c") ||
    getQueryValue(req, "click_id") ||
    sid ||
    getQueryValue(req, "fbclid") ||
    `clk_${crypto.randomBytes(6).toString("hex")}${Date.now().toString(36)}`;

  const dest = buildPartnerUrl(slug, clickId, { source, slug, sid });

  const logP = logOfferClick(req, {
    clickId,
    slug,
    partnerId: slug || "",
    destinationUrl: dest || "",
    source,
    sid,
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


module.exports = { affiliateRedirect };
