/**
 * Geo Location Detector — Ascendant Labs
 * 
 * Detects the user's country and regional context using edge proxy headers,
 * IP headers, and browser timezone/locale signals.
 */

const TIMEZONE_TO_COUNTRY = {
  // Asia
  'Asia/Singapore': 'SG',
  'Asia/Hong_Kong': 'HK',
  'Asia/Tokyo': 'JP',
  'Asia/Taipei': 'TW',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Seoul': 'KR',
  'Asia/Dubai': 'AE',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Shanghai': 'CN',

  // Oceania
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',

  // Europe
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Lisbon': 'PT',
  'Europe/Athens': 'GR',

  // North America - US
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Detroit': 'US',
  'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US',

  // North America - Canada
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Montreal': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',

  // Latin America
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'America/Bogota': 'CO',
  'America/Santiago': 'CL',
  'America/Buenos_Aires': 'AR',
};

const COUNTRY_NAMES = {
  SG: 'Singapore',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  SE: 'Sweden',
  CH: 'Switzerland',
  JP: 'Japan',
  KR: 'South Korea',
  HK: 'Hong Kong',
  MY: 'Malaysia',
  TH: 'Thailand',
  ID: 'Indonesia',
  PH: 'Philippines',
  IN: 'India',
  AE: 'United Arab Emirates',
  BR: 'Brazil',
  MX: 'Mexico',
};

function normalizeCountryCode(code) {
  if (!code || typeof code !== 'string') return null;
  const clean = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(clean)) return clean;
  return null;
}

/**
 * Extract country code from incoming HTTP request headers
 */
function extractCountryFromHeaders(headers = {}) {
  // Cloudflare
  const cf = normalizeCountryCode(headers['cf-ipcountry']);
  if (cf && cf !== 'XX' && cf !== 'T1') return cf;

  // Google App Engine / Cloud Run load balancer
  const gae = normalizeCountryCode(headers['x-appengine-country']);
  if (gae && gae !== 'ZZ') return gae;

  // Cloud Armor / Cloud CDN x-client-geo-location (e.g. "US,CA,San Francisco" or "country=US")
  const geoHeader = headers['x-client-geo-location'];
  if (geoHeader && typeof geoHeader === 'string') {
    const match = geoHeader.match(/country=([A-Z]{2})/i) || geoHeader.match(/^([A-Z]{2})/i);
    if (match) {
      const code = normalizeCountryCode(match[1]);
      if (code) return code;
    }
  }

  // AWS CloudFront
  const cfViewer = normalizeCountryCode(headers['cloudfront-viewer-country']);
  if (cfViewer) return cfViewer;

  // Generic / Vercel edge headers
  const generic = normalizeCountryCode(headers['x-country-code'] || headers['x-vercel-ip-country'] || headers['x-geoip-country-code']);
  if (generic) return generic;

  return null;
}

/**
 * Extract country code from client-provided browser context (timezone, language)
 */
function extractCountryFromClientContext(clientContext = {}) {
  // Explicit client-provided country code
  const explicit = normalizeCountryCode(clientContext.country);
  if (explicit) return explicit;

  // Timezone mapping
  const timeZone = String(clientContext.timeZone || '').trim();
  if (timeZone) {
    if (TIMEZONE_TO_COUNTRY[timeZone]) {
      return TIMEZONE_TO_COUNTRY[timeZone];
    }
    // Prefix fallback: Australia/*
    if (timeZone.startsWith('Australia/')) return 'AU';
  }

  // Locale fallback: e.g. "en-SG" -> "SG", "en-GB" -> "GB", "de-DE" -> "DE"
  const lang = String(clientContext.language || '').trim();
  if (lang) {
    const parts = lang.split(/[-_]/);
    if (parts.length >= 2) {
      const region = normalizeCountryCode(parts[1]);
      if (region) return region;
    }
  }

  return null;
}

/**
 * Detect client location from request headers and optional body payload
 */
function detectClientLocation(req, clientContext = {}) {
  const headers = req?.headers || {};
  const headerCountry = extractCountryFromHeaders(headers);
  const contextCountry = extractCountryFromClientContext(clientContext);

  const country = headerCountry || contextCountry || null;
  const timeZone = clientContext.timeZone || null;
  const countryName = country ? (COUNTRY_NAMES[country] || country) : null;

  return {
    country,
    countryName,
    timeZone,
    source: headerCountry ? 'header' : (contextCountry ? 'client_context' : 'unknown'),
  };
}

module.exports = {
  detectClientLocation,
  extractCountryFromHeaders,
  extractCountryFromClientContext,
  normalizeCountryCode,
  COUNTRY_NAMES,
};
