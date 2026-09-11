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
  capiAccessToken: optionalEnv("CAPI_ACCESS_TOKEN"),
  datasetId: optionalEnv("DATASET_ID"),
  partners: {
    prodentim: {
      label: "ProDentim",
      shortPath: "prodentim",
      aliases: ["prodentim", "prodentim101"],
      targetUrl: optionalEnv("PRODENTIM_AFFILIATE_URL", "https://prodentim.com/text.php"),
    },
    derila: {
      label: "Derila",
      shortPath: "derila",
      aliases: ["derila", "pillow"],
      targetUrl: optionalEnv("DERILA_AFFILIATE_URL", "https://derila-ergo.com"),
    },
  },
};

function findPartner(slug) {
  const key = String(slug || "").trim().toLowerCase();
  if (!key) return null;
  return Object.entries(config.partners).find(([, partner]) => {
    return (partner.aliases && partner.aliases.includes(key)) || partner.shortPath === key;
  }) || null;
}

function buildPartnerUrl(slug, clickId, extras = {}) {
  const found = findPartner(slug);
  if (!found) return null;
  const [, partner] = found;
  if (!partner.targetUrl) return null;
  try {
    const parsed = new URL(partner.targetUrl);
    if (clickId) {
      parsed.searchParams.set("tid", clickId);
      parsed.searchParams.set("aff_sub", clickId);
    }
    return parsed.toString();
  } catch (_) {
    const joiner = partner.targetUrl.includes("?") ? "&" : "?";
    return clickId ? `${partner.targetUrl}${joiner}tid=${encodeURIComponent(clickId)}` : partner.targetUrl;
  }
}

function shortLinkFor(slug) {
  const found = findPartner(slug);
  if (!found) return null;
  const path = found[1].shortPath;
  return `https://ascendantlabs.co/r/${path}`;
}

module.exports = {
  config,
  buildPartnerUrl,
  findPartner,
  shortLinkFor,
  requireEnv,
  optionalEnv,
};
