

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

const WARM_HTTP = { minInstances: 0, timeoutSeconds: 60, memory: "256MiB" };

module.exports = {
  getClientIp,
  getQueryValue,
  cors,
  WARM_HTTP,
};
