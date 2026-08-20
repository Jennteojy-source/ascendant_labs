const https = require("https");

function getClientIp(req) {
  let forwarded = "";
  if (typeof req.get === "function") {
    forwarded = req.get("x-forwarded-for") || "";
  } else if (req.headers && req.headers["x-forwarded-for"]) {
    forwarded = req.headers["x-forwarded-for"];
  }

  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    const ipv6 = parts.find((ip) => ip.includes(":") && !ip.startsWith("::ffff:"));
    if (ipv6) return ipv6;
    return parts[0].replace(/^::ffff:/, "");
  }
  const direct = req.ip || (req.connection && req.connection.remoteAddress) || "";
  return direct.replace(/^::ffff:/, "");
}

function getQueryValue(req, key) {
  const value = req.query[key];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function graphPostJson(hostname, path, token, payload, extraHeaders = {}) {
  const postData = JSON.stringify(payload);
  const options = {
    hostname,
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        console.log(`Graph POST ${path} status ${res.statusCode}: ${body}`);
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", (e) => {
      console.error(`Graph POST ${path} error: ${e.message}`);
      resolve({ status: 0, body: e.message });
    });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  getClientIp,
  getQueryValue,
  cors,
  graphPostJson,
};
