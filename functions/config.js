const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

const config = {
  networkId: optionalEnv("NETWORK_ID", "nordvpn"),
  webhookApiKey: optionalEnv("WEBHOOK_API_KEY", optionalEnv("API_KEY")),
  capiAccessToken: optionalEnv("CAPI_ACCESS_TOKEN"),
  datasetId: optionalEnv("DATASET_ID"),
  nordVpn: {
    baseUrl: optionalEnv("NORDVPN_AFFILIATE_BASE_URL", "https://go.nordvpn.net/aff_c"),
    affId: optionalEnv("NORDVPN_AFF_ID", "152405"),
    offerId: optionalEnv("NORDVPN_OFFER_ID", "15"),
    urlId: optionalEnv("NORDVPN_URL_ID", "902"),
  },
};

function buildAffiliateUrl(clickId) {
  const { baseUrl, affId, offerId, urlId } = config.nordVpn;
  const params = new URLSearchParams({
    offer_id: offerId,
    aff_id: affId,
    url_id: urlId,
  });

  if (clickId) {
    params.set("aff_click_id", clickId);
    params.set("aff_sub", clickId);
  }

  return `${baseUrl}?${params.toString()}`;
}

module.exports = {
  config,
  buildAffiliateUrl,
  requireEnv,
};
