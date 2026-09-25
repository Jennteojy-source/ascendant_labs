process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectClientLocation,
  extractCountryFromHeaders,
  extractCountryFromClientContext,
  normalizeCountryCode,
} = require('../lib/geo_detector');
const { expandQueryWithAI, buildFallbackExpansion } = require('../lib/ai_query_expander');

test('geo_detector extracts country from reverse proxy edge headers', () => {
  assert.equal(extractCountryFromHeaders({ 'cf-ipcountry': 'SG' }), 'SG');
  assert.equal(extractCountryFromHeaders({ 'cf-ipcountry': 'us' }), 'US');
  assert.equal(extractCountryFromHeaders({ 'x-appengine-country': 'GB' }), 'GB');
  assert.equal(extractCountryFromHeaders({ 'cloudfront-viewer-country': 'AU' }), 'AU');
  assert.equal(extractCountryFromHeaders({ 'x-client-geo-location': 'country=CA,city=Toronto' }), 'CA');
  assert.equal(extractCountryFromHeaders({ 'x-client-geo-location': 'FR,Paris' }), 'FR');
  assert.equal(extractCountryFromHeaders({ 'x-country-code': 'DE' }), 'DE');
  // Unknown or invalid headers return null
  assert.equal(extractCountryFromHeaders({ 'cf-ipcountry': 'XX' }), null);
  assert.equal(extractCountryFromHeaders({}), null);
});

test('geo_detector resolves country from client timezone and locale', () => {
  assert.equal(extractCountryFromClientContext({ timeZone: 'Asia/Singapore' }), 'SG');
  assert.equal(extractCountryFromClientContext({ timeZone: 'America/New_York' }), 'US');
  assert.equal(extractCountryFromClientContext({ timeZone: 'Europe/London' }), 'GB');
  assert.equal(extractCountryFromClientContext({ timeZone: 'Australia/Melbourne' }), 'AU');
  assert.equal(extractCountryFromClientContext({ timeZone: 'Asia/Tokyo' }), 'JP');

  // Prefix fallback
  assert.equal(extractCountryFromClientContext({ timeZone: 'Australia/Hobart' }), 'AU');

  // Locale fallback
  assert.equal(extractCountryFromClientContext({ language: 'en-SG' }), 'SG');
  assert.equal(extractCountryFromClientContext({ language: 'en-CA' }), 'CA');
  assert.equal(extractCountryFromClientContext({ language: 'de-DE' }), 'DE');
});

test('detectClientLocation prioritizes header over client context', () => {
  const req = { headers: { 'cf-ipcountry': 'SG' } };
  const clientContext = { timeZone: 'America/New_York', language: 'en-US' };
  const detected = detectClientLocation(req, clientContext);

  assert.equal(detected.country, 'SG');
  assert.equal(detected.countryName, 'Singapore');
  assert.equal(detected.source, 'header');
});

test('detectClientLocation falls back to client context when edge header is absent', () => {
  const req = { headers: {} };
  const clientContext = { timeZone: 'Asia/Singapore', language: 'en-SG' };
  const detected = detectClientLocation(req, clientContext);

  assert.equal(detected.country, 'SG');
  assert.equal(detected.countryName, 'Singapore');
  assert.equal(detected.source, 'client_context');
});

test('buildFallbackExpansion populates detectedUserCountry and localizationRationale', () => {
  const fallback = buildFallbackExpansion('ProtonVPN', {
    clientLocation: { country: 'SG', countryName: 'Singapore' },
  });

  assert.equal(fallback.brandName, 'ProtonVPN');
  assert.equal(fallback.detectedUserCountry, 'SG');
  assert.equal(fallback.targetCountry, 'ALL'); // Global by default unless query has explicit country
  assert.match(fallback.localizationRationale, /SG/);
});

test('buildFallbackExpansion honors explicit country inside query string', () => {
  const fallback = buildFallbackExpansion('gym membership Singapore', {
    clientLocation: { country: 'US', countryName: 'United States' },
  });

  assert.equal(fallback.targetCountry, 'SG');
  assert.equal(fallback.detectedUserCountry, 'US');
  assert.match(fallback.localizationRationale, /Explicit country/);
});
