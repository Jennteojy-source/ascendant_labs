/** Evidence that an ad actually names the product the user searched for. */
function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function identityNames(profile = {}, query = '') {
  const original = normalize(query);
  const brand = normalize(profile.brandName);
  return [...new Set([original, brand, ...(profile.aliases || []).map(normalize)].filter(Boolean))];
}

function adIdentityText(ad = {}) {
  const copy = ad.copy || {};
  return [ad.page_name, ad.pageName, ad.displayDomain, ad.destinationUrl,
    ...(ad.ad_creative_bodies || []), ...(ad.ad_creative_link_titles || []),
    ...(ad.ad_creative_link_descriptions || []), ...(ad.ad_creative_link_captions || []),
    copy.headline, copy.body, copy.description, copy.caption,
    ...(ad.variants || []).flatMap(v => [v.headline, v.body, v.description, v.caption])]
    .filter(Boolean).join(' ');
}

function matchesProductIdentity(ad, profile, query) {
  const text = normalize(adIdentityText(ad));
  const padded = ` ${text} `;
  const compact = text.replace(/ /g, '');
  return identityNames(profile, query).some(name => {
    if (padded.includes(` ${name} `)) return true;
    // Covers joined spellings such as YuSleep, but only for multiword names.
    return name.includes(' ') && compact.includes(name.replace(/ /g, ''));
  });
}

module.exports = { matchesProductIdentity, identityNames };
