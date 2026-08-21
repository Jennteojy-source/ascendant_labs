const https = require("https");
const crypto = require("crypto");
const { config } = require("../config");

function postCapiPayload(datasetId, token, payload, options = {}) {
  const label = options.label || "Meta CAPI";
  if (!datasetId || !token) {
    console.log(`${label} skip: missing dataset ID or access token`);
    return Promise.resolve({ skipped: true, status: 0, body: null });
  }

  const postData = JSON.stringify(payload);
  const requestOptions = {
    hostname: "graph.facebook.com",
    path: `/${options.apiVersion || "v25.0"}/${datasetId}/events`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(requestOptions, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        let parsedBody = responseBody;
        try { parsedBody = JSON.parse(responseBody); } catch (_) {}
        console.log(`${label} response: status ${res.statusCode}, body: ${responseBody}`);
        resolve({
          skipped: false,
          status: res.statusCode || 0,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          body: parsedBody,
        });
      });
    });

    req.on("error", (err) => {
      console.error(`${label} error: ${err.message}`);
      resolve({ skipped: false, status: 0, ok: false, body: null, error: err.message });
    });
    req.setTimeout(8000, () => {
      req.destroy(new Error("request_timeout"));
    });
    req.write(postData);
    req.end();
  });
}

function sendMetaCapiEvent(eventName, eventId, userData, customData = null, eventSourceUrl = "https://ascendantlabs.co/nordvpn/quiz") {
  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: {
      ...(userData.fbc ? { fbc: userData.fbc } : {}),
      ...(userData.fbp ? { fbp: userData.fbp } : {}),
      ...(userData.external_id ? { external_id: crypto.createHash("sha256").update(userData.external_id).digest("hex") } : {}),
      client_ip_address: userData.client_ip_address || "",
      client_user_agent: userData.client_user_agent || "",
    },
  };

  if (customData) {
    event.custom_data = customData;
  }

  return postCapiPayload(config.datasetId, config.capiAccessToken, { data: [event] }, {
    apiVersion: "v25.0",
    label: `Meta CAPI [${eventName}]`,
  });
}

function buildWhatsAppCapiPayload({
  eventName = "LeadSubmitted",
  eventId,
  eventTime = Date.now(),
  ctwaClid,
  wabaId,
}) {
  const numericTime = Number(eventTime);
  const eventTimeSeconds = Number.isFinite(numericTime)
    ? Math.floor(numericTime > 9999999999 ? numericTime / 1000 : numericTime)
    : Math.floor(Date.now() / 1000);
  const event = {
    event_name: eventName,
    event_time: eventTimeSeconds,
    event_id: eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: {
      whatsapp_business_account_id: String(wabaId || ""),
      ctwa_clid: String(ctwaClid || ""),
    },
  };
  return { data: [event] };
}

function sendWhatsAppCapiEvent({
  eventName = "LeadSubmitted",
  eventId,
  eventTime = Date.now(),
  ctwaClid,
}) {
  if (!ctwaClid) {
    return Promise.resolve({ skipped: true, reason: "missing_ctwa_clid", status: 0, body: null });
  }
  const payload = buildWhatsAppCapiPayload({
    eventName,
    eventId,
    eventTime,
    ctwaClid,
    wabaId: config.wabaId,
  });
  return postCapiPayload(
    config.whatsappDatasetId,
    config.whatsappCapiAccessToken,
    payload,
    { apiVersion: "v26.0", label: `WhatsApp CAPI [${eventName}]` }
  );
}

module.exports = {
  buildWhatsAppCapiPayload,
  sendMetaCapiEvent,
  sendWhatsAppCapiEvent,
};
