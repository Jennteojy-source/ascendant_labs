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
  capiAccessToken: optionalEnv("CAPI_ACCESS_TOKEN"),
  datasetId: optionalEnv("DATASET_ID"),
  webhookApiKey: optionalEnv("WEBHOOK_API_KEY"),
  webhookVerifyToken: optionalEnv("WEBHOOK_VERIFY_TOKEN", optionalEnv("WEBHOOK_API_KEY")),
  wabaToken: optionalEnv("WABA_TOKEN"),
  wabaId: optionalEnv("WABA_ID", "1243210237822104"),
  whatsappPhoneNumberId: optionalEnv("WHATSAPP_PHONE_NUMBER_ID", "1310118965513750"),
  whatsappDisplayNumber: optionalEnv("WHATSAPP_DISPLAY_NUMBER", "6580340915"),
  nordVpn: {
    baseUrl: optionalEnv("NORDVPN_AFFILIATE_BASE_URL", "https://go.nordvpn.net/aff_c"),
    affId: optionalEnv("NORDVPN_AFF_ID", "152405"),
    offerId: optionalEnv("NORDVPN_OFFER_ID", "658"),
    urlId: optionalEnv("NORDVPN_URL_ID", "902"),
  },
  partners: {
    nordvpn: {
      label: "NordVPN",
      shortPath: "vpn",
      aliases: ["nordvpn", "vpn", "nord-vpn"],
      url: optionalEnv("NORDVPN_AFFILIATE_URL"),
    },
    nordpass: {
      label: "NordPass",
      shortPath: "pass",
      aliases: ["nordpass", "pass", "nord-pass"],
      url: optionalEnv("NORDPASS_AFFILIATE_URL"),
    },
    proton_vpn: {
      label: "Proton VPN",
      shortPath: "proton-vpn",
      aliases: ["proton_vpn", "proton-vpn", "protonvpn"],
      url: optionalEnv("PROTON_VPN_AFFILIATE_URL"),
    },
    proton_pass: {
      label: "Proton Pass",
      shortPath: "proton-pass",
      aliases: ["proton_pass", "proton-pass", "protonpass"],
      url: optionalEnv("PROTON_PASS_AFFILIATE_URL"),
    },
    proton_mail: {
      label: "Proton Mail",
      shortPath: "proton-mail",
      aliases: ["proton_mail", "proton-mail", "protonmail"],
      url: optionalEnv("PROTON_MAIL_AFFILIATE_URL"),
    },
    proton_unlimited: {
      label: "Proton Unlimited",
      shortPath: "proton-unlimited",
      aliases: ["proton_unlimited", "proton-unlimited", "unlimited"],
      url: optionalEnv("PROTON_UNLIMITED_AFFILIATE_URL"),
    },
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

function findPartner(slug) {
  const key = String(slug || "").trim().toLowerCase();
  if (!key) return null;
  return Object.entries(config.partners).find(([, partner]) => {
    return partner.aliases.includes(key) || partner.shortPath === key;
  }) || null;
}

function appendClickId(url, clickId) {
  if (!url || !clickId) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("aff_click_id", clickId);
    parsed.searchParams.set("aff_sub", clickId);
    parsed.searchParams.set("click_id", clickId);
    return parsed.toString();
  } catch (_) {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}aff_click_id=${encodeURIComponent(clickId)}`;
  }
}

function buildPartnerUrl(slug, clickId) {
  const found = findPartner(slug);
  if (!found) return null;
  const [id, partner] = found;
  if (id === "nordvpn" || slug === "vpn") {
    return clickId ? buildAffiliateUrl(clickId) : buildAffiliateUrl();
  }
  if (!partner.url) return null;
  return appendClickId(partner.url, clickId);
}

function shortLinkFor(slug, clickId) {
  const found = findPartner(slug);
  if (!found) return null;
  const path = found[1].shortPath;
  const base = `https://ascendantlabs.co/r/${path}`;
  return clickId ? `${base}?c=${encodeURIComponent(clickId)}` : base;
}

function recommendFromScan(telemetry = {}) {
  const country = String(telemetry.country || "").toLowerCase();
  const isp = String(telemetry.isp || "").toLowerCase();
  const restricted = ["china", "iran", "russia", "belarus", "turkmenistan", "cuba", "north korea"];
  const privacyFirst = [
    "germany", "france", "netherlands", "sweden", "switzerland", "austria",
    "ireland", "belgium", "spain", "italy", "portugal", "poland", "finland",
    "denmark", "norway", "iceland",
  ];
  const ispVisible = /comcast|xfinity|verizon|at&t|\batt\b|spectrum|charter|bt |sky |vodafone|orange|telefonica|deutsche telekom|singtel|starhub|\bm1\b|pccw|hkt|telstra|optus|mobile|cellular|wireless|4g|5g/.test(isp);

  let primary = "nordvpn";
  let alternative = "proton_vpn";
  let angle = "Your internet provider can see this connection. A VPN hides that traffic from the network in front of you.";

  if (restricted.some((name) => country.includes(name))) {
    primary = "proton_vpn";
    alternative = "nordvpn";
    angle = "This network looks sensitive. Start with a privacy-first VPN from a recommended partner, then lock down passwords.";
  } else if (privacyFirst.some((name) => country.includes(name))) {
    primary = "proton_vpn";
    alternative = "nordvpn";
    angle = "In this region, a privacy-first VPN is usually the best first step, with a speed-focused VPN as the alternative.";
  } else if (ispVisible) {
    angle = `${telemetry.isp || "This provider"} can typically see unencrypted activity on this connection. A VPN hides browsing from that network.`;
  }

  return {
    primary,
    alternative,
    password: country.includes("eu") || privacyFirst.some((name) => country.includes(name)) ? "proton_pass" : "nordpass",
    angle,
    shortLinks: {
      primary: shortLinkFor(primary),
      alternative: shortLinkFor(alternative),
      password: shortLinkFor(privacyFirst.some((name) => country.includes(name)) ? "proton_pass" : "nordpass"),
    },
  };
}

module.exports = {
  config,
  buildAffiliateUrl,
  buildPartnerUrl,
  findPartner,
  shortLinkFor,
  recommendFromScan,
  requireEnv,
};
