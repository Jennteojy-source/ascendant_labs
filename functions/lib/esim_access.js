const crypto = require("crypto");
const { config } = require("../config");

const GB = 1073741824;

function generateHeaders(accessCode, body) {
  const timestamp = Date.now().toString();
  const requestId = crypto.randomUUID();
  const signStr = timestamp + requestId + accessCode + body;
  const signature = crypto.createHmac("sha256", accessCode).update(signStr).digest("hex").toLowerCase();
  return {
    "Content-Type": "application/json",
    "RT-AccessCode": accessCode,
    "RT-Timestamp": timestamp,
    "RT-RequestID": requestId,
    "RT-Signature": signature,
  };
}

async function esimAccessPost(path, bodyObj = {}) {
  const accessCode = config.esimAccess.accessCode;
  if (!accessCode) {
    throw new Error("Missing ACCESS_CODE for eSIM Access API");
  }
  const body = JSON.stringify(bodyObj);
  const res = await fetch(`${config.esimAccess.apiBase}${path}`, {
    method: "POST",
    headers: generateHeaders(accessCode, body),
    body,
  });
  const json = await res.json();
  if (!json || json.success !== true) {
    const err = new Error(json?.errorMsg || `eSIM Access ${path} failed`);
    err.payload = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

function listPackages(filters = {}) {
  return esimAccessPost("/package/list", {
    locationCode: filters.locationCode || "",
    type: filters.type || "",
    slug: filters.slug || "",
    packageCode: filters.packageCode || "",
    iccid: filters.iccid || "",
  });
}

function parseLocationCodes(pkg) {
  const fromNetworks = (pkg.locationNetworkList || [])
    .map((row) => String(row.locationCode || "").trim())
    .filter(Boolean);
  const fromField = String(pkg.locationCode || pkg.location || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([...fromNetworks, ...fromField])];
}

function networksFrom(pkg) {
  const names = [];
  for (const loc of pkg.locationNetworkList || []) {
    for (const op of loc.operatorList || []) {
      if (op.operatorName) names.push(op.operatorName);
    }
  }
  return [...new Set(names)];
}

function partitionId(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toPackageDoc(pkg, extras) {
  const volumeGb = pkg.volume ? Math.round((pkg.volume / GB) * 100) / 100 : 0;
  const durationDays = Number(pkg.duration) || 0;
  const priceUsd = (Number(pkg.price) || 0) / 10000;
  const retailUsd = (Number(pkg.retailPrice) || 0) / 10000;
  const markup = config.esimAccess.sellMarkup;
  const sellUsd = Math.round(priceUsd * markup * 100) / 100;
  const locationCodes = parseLocationCodes(pkg);
  const networks = networksFrom(pkg);
  const searchText = [
    pkg.name,
    pkg.slug,
    pkg.packageCode,
    pkg.description,
    pkg.speed,
    pkg.fupPolicy,
    locationCodes.join(" "),
    networks.join(" "),
    volumeGb ? `${volumeGb}gb` : "",
    durationDays ? `${durationDays} days` : "",
    pkg.supportTopUpType === 2 ? "topup top-up" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    packageCode: pkg.packageCode || "",
    slug: pkg.slug || "",
    name: pkg.name || "",
    price: pkg.price ?? null,
    currencyCode: pkg.currencyCode || "USD",
    volume: pkg.volume ?? null,
    smsStatus: pkg.smsStatus ?? null,
    dataType: pkg.dataType ?? null,
    unusedValidTime: pkg.unusedValidTime ?? null,
    duration: pkg.duration ?? null,
    durationUnit: pkg.durationUnit || "",
    durationType: pkg.durationType ?? null,
    location: pkg.location || "",
    locationCode: locationCodes[0] || pkg.locationCode || "",
    description: pkg.description || "",
    descriptionList: pkg.descriptionList || [],
    saleNote: pkg.saleNote || "",
    activeType: pkg.activeType ?? null,
    favorite: pkg.favorite === true,
    retailPrice: pkg.retailPrice ?? null,
    speed: pkg.speed || "",
    ipExport: pkg.ipExport || "",
    supportTopUpType: pkg.supportTopUpType ?? null,
    fupPolicy: pkg.fupPolicy || "",
    locationNetworkList: pkg.locationNetworkList || [],
    discountRuleCode: pkg.discountRuleCode || "",
    priceUsd,
    retailUsd,
    sellUsd,
    volumeGb,
    durationDays,
    locationCodes,
    networks,
    supportTopUp: pkg.supportTopUpType === 2,
    searchText,
    partition: extras.partition,
    syncedAt: extras.syncedAt,
    expireAt: extras.expireAt,
  };
}

module.exports = {
  esimAccessPost,
  listPackages,
  parseLocationCodes,
  partitionId,
  toPackageDoc,
};
