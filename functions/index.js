/**
 * Cloud Functions entry for Ascendant Labs
 */
const { sendMetaCapiEvent } = require("./lib/capi");
const affiliate = require("./routes/affiliate");

exports.affiliateRedirect = affiliate.affiliateRedirect;
exports.sendMetaCapiEvent = sendMetaCapiEvent;
