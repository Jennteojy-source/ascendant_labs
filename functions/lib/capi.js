const https = require("https");
const crypto = require("crypto");
const { config } = require("../config");

function sendMetaCapiEvent(eventName, eventId, userData, customData = null, eventSourceUrl = "https://ascendantlabs.co/nordvpn/quiz") {
  if (!config.datasetId || !config.capiAccessToken) {
    console.log("Meta CAPI skip: missing dataset ID or access token");
    return Promise.resolve();
  }

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

  const payload = { data: [event] };
  const postData = JSON.stringify(payload);
  const options = {
    hostname: "graph.facebook.com",
    path: `/v25.0/${config.datasetId}/events`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      Authorization: `Bearer ${config.capiAccessToken}`,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`Meta CAPI [${eventName}] response: status ${res.statusCode}, body: ${body}`);
        resolve();
      });
    });

    req.on("error", (e) => {
      console.error(`Meta CAPI [${eventName}] error: ${e.message}`);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

module.exports = { sendMetaCapiEvent };
