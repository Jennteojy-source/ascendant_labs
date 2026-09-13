const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { config, buildPartnerUrl } = require("../config");
const { admin, db } = require("../lib/firebase");
const { getClientIp, cors, WARM_HTTP } = require("../lib/http");
const { sendMetaCapiEvent } = require("../lib/capi");

const IATA_RE = /^[A-Z]{3}$/;

function normalizeIata(value) {
  const code = String(value || "").trim().toUpperCase();
  return IATA_RE.test(code) ? code : "";
}

function cookieValue(req, name) {
  const raw = req.get("cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function buildFunnelUrl(originIata, destIata, disruptionType = "delayed", clickId = "") {
  try {
    const targetFunnel = new URL("https://funnel.airhelp.com/claims/new/trip-details");
    if (originIata) targetFunnel.searchParams.set("departureAirportIata", originIata);
    if (destIata) targetFunnel.searchParams.set("arrivalAirportIata", destIata);
    if (disruptionType && (disruptionType === "delayed" || disruptionType === "cancelled")) {
      targetFunnel.searchParams.set("disruption_type", disruptionType);
    }
    targetFunnel.searchParams.set("lang", "en");

    const tpUrl = new URL("https://tp.media/r");
    tpUrl.searchParams.set("campaign_id", "120");
    tpUrl.searchParams.set("marker", "777015");
    tpUrl.searchParams.set("p", "9139");
    tpUrl.searchParams.set("trs", "573423");
    if (clickId) {
      tpUrl.searchParams.set("sub_id", clickId);
    }
    tpUrl.searchParams.set("u", targetFunnel.toString());
    return tpUrl.toString();
  } catch (_) {
    return "https://airhelp.tpx.lu/3XDklWHQ";
  }
}

function parseBody(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const query = req.query && typeof req.query === "object" ? req.query : {};
  const rawDisruption = String(body.disruptionType || query.disruptionType || "delayed").toLowerCase();
  return {
    originIata: normalizeIata(body.originIata || body.from || query.originIata || query.from),
    destIata: normalizeIata(body.destIata || body.to || query.destIata || query.to),
    disruptionType: rawDisruption === "cancelled" ? "cancelled" : "delayed",
    originLabel: String(body.originLabel || body.origin || "").slice(0, 120),
    destLabel: String(body.destLabel || body.destination || "").slice(0, 120),
    eventId: String(body.eventId || query.eventId || "").slice(0, 80),
    fbp: String(body.fbp || cookieValue(req, "_fbp") || "").slice(0, 120),
    fbc: String(body.fbc || cookieValue(req, "_fbc") || "").slice(0, 180),
    source: String(body.source || query.source || "web").slice(0, 40),
    eventSourceUrl: String(body.eventSourceUrl || req.get("referer") || "https://ascendantlabs.co/").slice(0, 500),
  };
}

function wantsJson(req) {
  const accept = String(req.get("accept") || "");
  const type = String(req.get("content-type") || "");
  return type.includes("application/json") || accept.includes("application/json");
}

const claimStart = onRequest(WARM_HTTP, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fields = parseBody(req);
  if (!fields.originIata || !fields.destIata) {
    res.status(400).json({ error: "originIata and destIata are required" });
    return;
  }

  const clickedAt = Date.now();
  const eventId = fields.eventId || `lead_${clickedAt}_${crypto.randomBytes(5).toString("hex")}`;
  const clickId = `clk_${crypto.randomBytes(6).toString("hex")}${clickedAt.toString(36)}`;
  const ip = getClientIp(req);
  const userAgent = req.get("user-agent") || "";
  const fbclidMatch = String(req.query.fbclid || "");
  const fbc = fields.fbc || (fbclidMatch ? `fb.1.${clickedAt}.${fbclidMatch}` : "");
  const redirectUrl = buildFunnelUrl(fields.originIata, fields.destIata, fields.disruptionType, clickId);

  const record = {
    id: eventId,
    clickId,
    originIata: fields.originIata,
    destIata: fields.destIata,
    disruptionType: fields.disruptionType,
    originLabel: fields.originLabel,
    destLabel: fields.destLabel,
    source: fields.source,
    ip,
    userAgent,
    fbp: fields.fbp,
    fbc,
    redirectUrl,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  const writes = [
    db.collection("claim_starts").doc(eventId).set(record, { merge: true }),
    db.collection("claim_clicks").doc(clickId).set({
      clickId,
      eventId,
      originIata: fields.originIata,
      destIata: fields.destIata,
      disruptionType: fields.disruptionType,
      ip,
      userAgent,
      fbp: fields.fbp,
      fbc,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
  ];

  const capiPromise = sendMetaCapiEvent(
    "Lead",
    eventId,
    {
      client_ip_address: ip,
      client_user_agent: userAgent,
      external_id: clickId,
      ...(fields.fbp ? { fbp: fields.fbp } : {}),
      ...(fbc ? { fbc } : {}),
    },
    {
      content_name: `${fields.originIata}-${fields.destIata} (${fields.disruptionType})`,
      content_category: "Flight Compensation Route",
      content_ids: [`${fields.originIata}-${fields.destIata}`],
      content_type: "product",
      status: fields.disruptionType,
    },
    fields.eventSourceUrl || "https://ascendantlabs.co/"
  );

  try {
    await Promise.allSettled([...writes, capiPromise]);
  } catch (err) {
    console.error("claim_start log error:", err);
  }

  if (wantsJson(req) && req.method === "POST") {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, eventId, clickId, redirectUrl });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.redirect(302, redirectUrl);
});

module.exports = {
  claimStart,
  buildFunnelUrl,
};
