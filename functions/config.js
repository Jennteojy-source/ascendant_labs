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
  whatsappDatasetId: optionalEnv("WHATSAPP_DATASET_ID", "1306778361353446"),
  whatsappCapiAccessToken: optionalEnv("WHATSAPP_CAPI_ACCESS_TOKEN", optionalEnv("WABA_TOKEN")),
  webhookApiKey: optionalEnv("WEBHOOK_API_KEY"),
  webhookVerifyToken: optionalEnv("WEBHOOK_VERIFY_TOKEN", optionalEnv("WEBHOOK_API_KEY")),
  wabaToken: optionalEnv("WABA_TOKEN"),
  wabaId: optionalEnv("WABA_ID", "1243210237822104"),
  whatsappPhoneNumberId: optionalEnv("WHATSAPP_PHONE_NUMBER_ID", "1310118965513750"),
  whatsappDisplayNumber: optionalEnv("WHATSAPP_DISPLAY_NUMBER", "6580340915"),
  nordVpn: {
    baseUrl: optionalEnv("NORDVPN_AFFILIATE_BASE_URL", "https://go.nordvpn.net/aff_c"),
    affId: optionalEnv("NORDVPN_AFF_ID", "152405"),
    offerId: optionalEnv("NORDVPN_OFFER_ID", "15"),
    urlId: optionalEnv("NORDVPN_URL_ID", "902"),
  },
  partners: {
    nordvpn: {
      label: "NordVPN",
      shortPath: "vpn",
      aliases: ["nordvpn", "vpn", "nord-vpn"],
      baseUrl: optionalEnv("NORDVPN_AFFILIATE_BASE_URL", "https://go.nordvpn.net/aff_c"),
      affId: optionalEnv("NORDVPN_AFF_ID", "152405"),
      offerId: optionalEnv("NORDVPN_OFFER_ID", "15"),
      urlId: optionalEnv("NORDVPN_URL_ID", "902"),
    },
    nordpass: {
      label: "NordPass",
      shortPath: "pass",
      aliases: ["nordpass", "pass", "nord-pass"],
      baseUrl: optionalEnv("NORDPASS_AFFILIATE_BASE_URL", "https://go.nordpass.io/aff_c"),
      affId: optionalEnv("NORDPASS_AFF_ID", "152405"),
      offerId: optionalEnv("NORDPASS_OFFER_ID", "488"),
      urlId: optionalEnv("NORDPASS_URL_ID", "9356"),
    },
    proton_vpn: {
      label: "Proton VPN",
      shortPath: "proton-vpn",
      aliases: ["proton_vpn", "proton-vpn", "protonvpn"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_VPN_OFFER_ID", "26"),
      urlId: optionalEnv("PROTON_VPN_URL_ID", ""),
    },
    proton_pass: {
      label: "Proton Pass",
      shortPath: "proton-pass",
      aliases: ["proton_pass", "proton-pass", "protonpass"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_PASS_OFFER_ID", "38"),
      urlId: optionalEnv("PROTON_PASS_URL_ID", ""),
    },
    proton_mail: {
      label: "Proton Mail",
      shortPath: "proton-mail",
      aliases: ["proton_mail", "proton-mail", "protonmail"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_MAIL_OFFER_ID", "7"),
      urlId: optionalEnv("PROTON_MAIL_URL_ID", ""),
    },
    proton_drive: {
      label: "Proton Drive",
      shortPath: "proton-drive",
      aliases: ["proton_drive", "proton-drive", "protondrive", "drive"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_DRIVE_OFFER_ID", "43"),
      urlId: optionalEnv("PROTON_DRIVE_URL_ID", ""),
    },
    proton_lumo: {
      label: "Proton Lumo",
      shortPath: "proton-lumo",
      aliases: ["proton_lumo", "proton-lumo", "lumo"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_LUMO_OFFER_ID", "68"),
      urlId: optionalEnv("PROTON_LUMO_URL_ID", ""),
    },
    proton_unlimited: {
      label: "Proton Unlimited",
      shortPath: "proton-unlimited",
      aliases: ["proton_unlimited", "proton-unlimited", "unlimited"],
      baseUrl: optionalEnv("PROTON_AFFILIATE_BASE_URL", "https://go.getproton.me/aff_c"),
      affId: optionalEnv("PROTON_AFF_ID", "19026"),
      offerId: optionalEnv("PROTON_UNLIMITED_OFFER_ID", "26"),
      urlId: optionalEnv("PROTON_UNLIMITED_URL_ID", "1198"),
    },
  },
};

function buildTuneUrl(offer, clickId, extras = {}) {
  if (!offer || !offer.baseUrl || !offer.offerId || !offer.affId) return null;
  const params = new URLSearchParams({
    offer_id: String(offer.offerId),
    aff_id: String(offer.affId),
  });
  if (offer.urlId) params.set("url_id", String(offer.urlId));
  if (clickId) {
    params.set("aff_click_id", clickId);
    params.set("aff_sub", clickId);
  }
  if (extras.source) params.set("aff_sub2", String(extras.source).slice(0, 64));
  if (extras.slug) params.set("aff_sub3", String(extras.slug).slice(0, 64));
  // aff_sub already carries the click id, and the scan id is used as the click
  // id when the tap came from a scan, so only send aff_sub4 when it adds value.
  if (extras.sid && extras.sid !== clickId) params.set("aff_sub4", String(extras.sid).slice(0, 80));
  return `${offer.baseUrl}?${params.toString()}`;
}

function buildAffiliateUrl(clickId, extras = {}) {
  return buildTuneUrl(config.nordVpn, clickId, extras);
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

function buildPartnerUrl(slug, clickId, extras = {}) {
  const found = findPartner(slug);
  if (!found) return null;
  const [, partner] = found;
  return buildTuneUrl(partner, clickId, { ...extras, slug: extras.slug || partner.shortPath });
}

/**
 * Short links carry at most one identifier per lookup: `sid` for the scan and
 * `wa` for the conversation. The redirect falls back to `sid` as the click id,
 * so an extra `c` parameter would only repeat the same value.
 */
function shortLinkFor(slug, sid) {
  const found = findPartner(slug);
  if (!found) return null;
  const path = found[1].shortPath;
  const base = `https://ascendantlabs.co/r/${path}`;
  return sid ? `${base}?sid=${encodeURIComponent(sid)}` : base;
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
      primary: shortLinkFor(primary, telemetry.sid),
      alternative: shortLinkFor(alternative, telemetry.sid),
      password: shortLinkFor(
        privacyFirst.some((name) => country.includes(name)) ? "proton_pass" : "nordpass",
        telemetry.sid
      ),
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
