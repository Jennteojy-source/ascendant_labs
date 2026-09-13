/**
 * Cloud Functions entry for Ascendant Labs
 */
const { sendMetaCapiEvent } = require("./lib/capi");
const affiliate = require("./routes/affiliate");
const claim = require("./routes/claim");
const sync = require("./routes/syncConversions");

exports.affiliateRedirect = affiliate.affiliateRedirect;
exports.claimStart = claim.claimStart;
exports.syncConversionsCron = sync.syncConversionsCron;
exports.syncConversionsHttp = sync.syncConversionsHttp;
exports.sendMetaCapiEvent = sendMetaCapiEvent;
