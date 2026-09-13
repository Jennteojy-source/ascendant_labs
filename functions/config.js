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
    airhelp: {
      label: "AirHelp Flight Delay Compensation",
      shortPath: "airhelp",
      aliases: ["airhelp", "flight", "flights", "flight-delay", "compensation"],
      targetUrl: optionalEnv("AIRHELP_AFFILIATE_URL", "https://funnel.airhelp.com/claims/new?lang=en"),
    },
    vpn: {
      label: "NordVPN",
      shortPath: "vpn",
      aliases: ["vpn", "nord", "nordvpn"],
      targetUrl: optionalEnv("NORDVPN_AFFILIATE_URL", "https://go.nordvpn.net/aff_c?offer_id=15&aff_id=141870"),
    },
    proton: {
      label: "Proton VPN",
      shortPath: "proton-vpn",
      aliases: ["proton-vpn", "proton", "protonvpn"],
      targetUrl: optionalEnv("PROTONVPN_AFFILIATE_URL", "https://go.getproton.me/aff_c?offer_id=26&aff_id=141870"),
    },
    pass: {
      label: "NordPass",
      shortPath: "pass",
      aliases: ["pass", "nordpass"],
      targetUrl: optionalEnv("NORDPASS_AFFILIATE_URL", "https://go.nordpass.io/aff_c?offer_id=488&aff_id=141870"),
    },
    mail: {
      label: "Proton Mail",
      shortPath: "proton-mail",
      aliases: ["proton-mail", "mail"],
      targetUrl: optionalEnv("PROTONMAIL_AFFILIATE_URL", "https://go.getproton.me/aff_c?offer_id=7&aff_id=141870"),
    },
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
    if (extras.query && typeof extras.query === "object") {
      for (const [k, v] of Object.entries(extras.query)) {
        if (!["c", "click_id", "tid", "aff_sub", "utm_source"].includes(k) && v) {
          parsed.searchParams.set(k, String(v));
        }
      }
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
