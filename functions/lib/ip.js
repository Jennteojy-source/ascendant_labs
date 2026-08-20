const http = require("http");

const telemetryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function resolveIpInfo(ip) {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return Promise.resolve(null);
  }

  const cached = telemetryCache.get(ip);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return Promise.resolve(cached.data);
  }

  return new Promise((resolve) => {
    const request = http.get(
      `http://ip-api.com/json/${ip}?fields=status,city,district,regionName,country,isp,org,as,query`,
      { timeout: 2500 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status !== "success") {
              resolve(null);
              return;
            }
            const cleanIsp = (parsed.isp || parsed.org || parsed.as || "").replace(/^AS\d+\s+/i, "").trim();
            const result = {
              city: parsed.city || "",
              district: parsed.district || "",
              region: parsed.regionName || "",
              country: parsed.country || "",
              isp: cleanIsp || "",
            };
            telemetryCache.set(ip, { data: result, ts: Date.now() });
            resolve(result);
          } catch (e) {
            console.warn("Telemetry parse error:", e.message);
            resolve(null);
          }
        });
      }
    );

    request.on("error", (e) => {
      console.warn("Telemetry fetch error:", e.message);
      resolve(null);
    });
    request.on("timeout", () => {
      request.destroy();
      console.warn("Telemetry fetch timeout for IP:", ip);
      resolve(null);
    });
  });
}

function formatDisplayIp(rawIp) {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rawIp.trim())) {
    return rawIp.trim();
  }
  let hash = 0;
  const str = String(rawIp);
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const b1 = 100 + Math.abs(hash % 90);
  const b2 = 10 + Math.abs((hash >> 3) % 200);
  const b3 = 10 + Math.abs((hash >> 6) % 220);
  const b4 = 10 + Math.abs((hash >> 9) % 240);
  return `${b1}.${b2}.${b3}.${b4}`;
}

module.exports = { resolveIpInfo, formatDisplayIp };
